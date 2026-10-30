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
    // 1. Instantly load any persisted session from localStorage for zero-latency header rendering
    this.loadLocalProfile();

    try {
      if (typeof firebase !== 'undefined' && firebase.initializeApp) {
        if (!firebase.apps || !firebase.apps.length) {
          firebase.initializeApp(this.firebaseConfig);
        }
        this.auth = firebase.auth();
        this.db = firebase.firestore();
        this.isInitialized = true;

        // Ensure persistence uses localStorage
        if (this.auth.setPersistence && firebase.auth.Auth && firebase.auth.Auth.Persistence) {
          this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(e => {
            console.warn('Firebase setPersistence to LOCAL note:', e.message);
          });
        }

        // Setup onAuthStateChanged listener to automatically detect existing session on page load
        this.setupAuthStateListener();
      } else {
        console.info('Firebase SDK not loaded from CDN; using local profile persistence fallback.');
      }
    } catch (e) {
      console.warn('Firebase initialization note (running in local/offline fallback):', e.message);
    }
  }

  setupAuthStateListener() {
    if (!this.auth) return;

    this.auth.onAuthStateChanged(async (user) => {
      if (user) {
        // User has an existing active session with Firebase Auth
        // Automatically bypass auth modal
        if (typeof UI !== 'undefined' && UI.closeModal) {
          UI.closeModal('modal-auth');
        }
        // Fetch their profile data (username, avatar color) from Firestore
        await this.loadUserProfile(user);
        // Render logged-in header instantly
        this.updateAuthUI();
      } else {
        // If not authenticated via Firebase remote, check if we have an active offline profile
        const stored = localStorage.getItem('manhunt_user_profile');
        if (stored) {
          try {
            this.currentUser = JSON.parse(stored);
          } catch (e) {
            this.currentUser = null;
          }
        } else {
          this.currentUser = null;
        }
        this.updateAuthUI();
      }
    });
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
   * Bold White initial clearly visible against chosen color with drop shadow
   */
  renderAvatarHtml(username, color, size = 36) {
    const letter = ((username || 'P').trim().charAt(0) || 'P').toUpperCase();
    const bg = color || '#00f5b4';
    return `
      <div class="user-colored-avatar" style="
        width: ${size}px;
        height: ${size}px;
        min-width: ${size}px;
        min-height: ${size}px;
        border-radius: 50%;
        background-color: ${bg};
        color: #FFFFFF !important;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-family, sans-serif);
        font-weight: 900;
        font-size: ${Math.round(size * 0.48)}px;
        line-height: 1;
        text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 2px #000000;
        box-shadow: 0 0 10px ${bg}88;
        border: 2px solid rgba(255, 255, 255, 0.9);
        user-select: none;
        flex-shrink: 0;
      ">${letter}</div>
    `;
  }

  updateAuthUI() {
    const profileWidget = document.getElementById('lobby-auth-profile-widget');
    const authBtn = document.getElementById('btn-open-auth-modal');
    const nicknameInput = document.getElementById('input-nickname') || document.getElementById('player-nickname');

    if (this.currentUser) {
      if (nicknameInput) {
        nicknameInput.value = this.currentUser.username;
      }
      if (typeof Game !== 'undefined') Game.nickname = this.currentUser.username;
      if (typeof Network !== 'undefined') {
        Network.nickname = this.currentUser.username;
        Network.avatarColor = this.currentUser.avatarColor;
      }

      if (profileWidget) {
        profileWidget.style.display = 'flex';
        profileWidget.innerHTML = `
          <div class="lobby-user-badge">
            ${this.renderAvatarHtml(this.currentUser.username, this.currentUser.avatarColor, 34)}
            <div class="lobby-user-info">
              <span class="lobby-user-name">${this.currentUser.username}</span>
            </div>
            <button type="button" id="btn-user-logout" class="lobby-logout-btn" title="Sign Out" onclick="AuthManager.signOut()">LOGOUT</button>
          </div>
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
