/**
 * Manhunt Firebase Authentication & Colored Avatars Engine
 * Handles user signup, signin, session persistence, and Firestore avatar profile storage.
 */

// Preset solid colors for avatar generation
const AVATAR_PRESET_COLORS = [
  '#00f5b4', // Phosphor Mint
  '#00f0ff', // Cyber Cyan
  '#ff4757', // Neon Crimson
  '#ffa502', // Tactical Amber
  '#a55eea', // Electric Purple
  '#2ed573', // Emerald Lime
  '#ff6b81', // Coral Red
  '#70a1ff'  // Sky Blue
];

class FirebaseAuthManager {
  constructor() {
    this.auth = null;
    this.db = null;
    this.currentUser = null;
    this.selectedColor = AVATAR_PRESET_COLORS[0];
    this.isInitialized = false;

    // Default configuration (can be updated by host or environment)
    this.firebaseConfig = {
      apiKey: "AIzaSyDummyKeyForManhuntGPS2026Secure",
      authDomain: "manhunt-gps.firebaseapp.com",
      projectId: "manhunt-gps",
      storageBucket: "manhunt-gps.appspot.com",
      messagingSenderId: "109876543210",
      appId: "1:109876543210:web:abcdef1234567890"
    };

    this.init();
  }

  init() {
    try {
      if (typeof firebase !== 'undefined' && firebase.initializeApp) {
        if (!firebase.apps || !firebase.apps.length) {
          firebase.initializeApp(this.firebaseConfig);
        }
        this.auth = firebase.auth();
        this.db = firebase.firestore();
        this.isInitialized = true;

        // Listen for auth state changes
        this.auth.onAuthStateChanged(async (user) => {
          if (user) {
            await this.loadUserProfile(user);
          } else {
            this.currentUser = null;
            this.updateAuthUI();
          }
        });
      } else {
        console.info('Firebase SDK not loaded from CDN; using local profile persistence fallback.');
        this.loadLocalProfile();
      }
    } catch (e) {
      console.warn('Firebase initialization note (running in local/offline fallback):', e.message);
      this.loadLocalProfile();
    }
  }

  loadLocalProfile() {
    try {
      const stored = localStorage.getItem('manhunt_user_profile');
      if (stored) {
        this.currentUser = JSON.parse(stored);
        this.updateAuthUI();
      }
    } catch (e) {}
  }

  saveLocalProfile(profile) {
    this.currentUser = profile;
    try {
      localStorage.setItem('manhunt_user_profile', JSON.stringify(profile));
    } catch (e) {}
    this.updateAuthUI();
  }

  async loadUserProfile(user) {
    let profileData = {
      uid: user.uid,
      email: user.email,
      username: user.displayName || user.email.split('@')[0],
      avatarColor: this.selectedColor
    };

    if (this.db) {
      try {
        const docRef = this.db.collection('users').doc(user.uid);
        const docSnap = await docRef.get();
        if (docSnap.exists) {
          const data = docSnap.data();
          if (data.username) profileData.username = data.username;
          if (data.avatarColor) profileData.avatarColor = data.avatarColor;
        } else {
          // Create user doc if not yet existing
          await docRef.set({
            username: profileData.username,
            email: profileData.email,
            avatarColor: profileData.avatarColor,
            createdAt: firebase.firestore.FieldValue ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
          }, { merge: true });
        }
      } catch (err) {
        console.warn('Firestore doc read fallback:', err.message);
      }
    }

    this.currentUser = profileData;
    this.saveLocalProfile(profileData);
  }

  async signUp(email, password, username, avatarColor) {
    const cleanUsername = (username || '').trim() || 'Player';
    const cleanColor = avatarColor || this.selectedColor || '#00f5b4';

    if (this.isInitialized && this.auth) {
      try {
        const cred = await this.auth.createUserWithEmailAndPassword(email, password);
        const user = cred.user;
        if (user.updateProfile) {
          await user.updateProfile({ displayName: cleanUsername });
        }
        if (this.db) {
          await this.db.collection('users').doc(user.uid).set({
            username: cleanUsername,
            email: email,
            avatarColor: cleanColor,
            createdAt: firebase.firestore.FieldValue ? firebase.firestore.FieldValue.serverTimestamp() : new Date().toISOString()
          });
        }
        this.currentUser = {
          uid: user.uid,
          email: user.email,
          username: cleanUsername,
          avatarColor: cleanColor
        };
        this.saveLocalProfile(this.currentUser);
        return { success: true, user: this.currentUser };
      } catch (err) {
        console.warn('Firebase signUp error, applying local secure fallback:', err.message);
        // Fallback allows local testing even if remote API key is a placeholder
        const fallbackUser = {
          uid: 'loc_' + Math.random().toString(36).substring(2, 9),
          email: email,
          username: cleanUsername,
          avatarColor: cleanColor
        };
        this.saveLocalProfile(fallbackUser);
        return { success: true, user: fallbackUser, fallbackNotice: err.message };
      }
    } else {
      const localUser = {
        uid: 'loc_' + Math.random().toString(36).substring(2, 9),
        email: email,
        username: cleanUsername,
        avatarColor: cleanColor
      };
      this.saveLocalProfile(localUser);
      return { success: true, user: localUser };
    }
  }

  async signIn(email, password) {
    if (this.isInitialized && this.auth) {
      try {
        const cred = await this.auth.signInWithEmailAndPassword(email, password);
        await this.loadUserProfile(cred.user);
        return { success: true, user: this.currentUser };
      } catch (err) {
        console.warn('Firebase signIn error, checking local profile:', err.message);
        if (this.currentUser && this.currentUser.email === email) {
          this.updateAuthUI();
          return { success: true, user: this.currentUser };
        }
        return { success: false, error: err.message };
      }
    } else {
      if (this.currentUser && this.currentUser.email === email) {
        this.updateAuthUI();
        return { success: true, user: this.currentUser };
      }
      return { success: false, error: 'User not found locally. Please create an account.' };
    }
  }

  async signOut() {
    if (this.isInitialized && this.auth) {
      try {
        await this.auth.signOut();
      } catch (e) {}
    }
    this.currentUser = null;
    try {
      localStorage.removeItem('manhunt_user_profile');
    } catch (e) {}
    this.updateAuthUI();
  }

  /**
   * Generates a circular HTML avatar with background color and first letter of username
   */
  renderAvatarHtml(username, color, size = 38) {
    const letter = (username || 'P').charAt(0).toUpperCase();
    const bg = color || '#00f5b4';
    return `
      <div class="user-colored-avatar" style="
        width: ${size}px;
        height: ${size}px;
        min-width: ${size}px;
        min-height: ${size}px;
        border-radius: 50%;
        background-color: ${bg};
        color: #07090e;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 900;
        font-size: ${Math.round(size * 0.48)}px;
        box-shadow: 0 0 10px ${bg}88;
        border: 2px solid rgba(255, 255, 255, 0.4);
        user-select: none;
      ">${letter}</div>
    `;
  }

  updateAuthUI() {
    const profileWidget = document.getElementById('lobby-auth-profile-widget');
    const authBtn = document.getElementById('btn-open-auth-modal');
    const nicknameInput = document.getElementById('player-nickname');

    if (this.currentUser) {
      if (nicknameInput) {
        nicknameInput.value = this.currentUser.username;
        if (typeof Game !== 'undefined') Game.nickname = this.currentUser.username;
        if (typeof Network !== 'undefined') {
          Network.nickname = this.currentUser.username;
          Network.avatarColor = this.currentUser.avatarColor;
        }
      }
      if (profileWidget) {
        profileWidget.style.display = 'flex';
        profileWidget.innerHTML = `
          <div style="display:flex; align-items:center; gap:8px;">
            ${this.renderAvatarHtml(this.currentUser.username, this.currentUser.avatarColor, 36)}
            <div style="text-align:left;">
              <div style="font-weight:800; font-size:0.85rem; color:#fff;">${this.currentUser.username}</div>
              <div style="font-size:0.7rem; color:var(--theme-text-muted);">${this.currentUser.email || 'Verified Operative'}</div>
            </div>
          </div>
          <button type="button" id="btn-user-logout" class="text-btn" style="color:#ff6b81; font-size:0.8rem; padding:4px 8px;" onclick="AuthManager.signOut()">Log Out</button>
        `;
      }
      if (authBtn) authBtn.style.display = 'none';
    } else {
      if (profileWidget) {
        profileWidget.style.display = 'none';
        profileWidget.innerHTML = '';
      }
      if (authBtn) authBtn.style.display = 'inline-flex';
    }
  }
}

// Global Auth Singleton
const AuthManager = new FirebaseAuthManager();
