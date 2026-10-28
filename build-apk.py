import os
import sys
import subprocess
import shutil
import zipfile
import glob

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__)))
BUILD_DIR = os.path.join(BASE_DIR, "build")
TOOLS_DIR = os.path.join(BASE_DIR, "build-tools")

AAPT2 = os.path.join(TOOLS_DIR, "aapt2.exe")
ANDROID_JAR = os.path.join(TOOLS_DIR, "android.jar")
R8_JAR = os.path.join(TOOLS_DIR, "r8.jar")
ZIPALIGN = os.path.join(TOOLS_DIR, "zipalign.exe")
APKSIGNER = os.path.join(TOOLS_DIR, "apksigner.jar")

MANIFEST = os.path.join(BASE_DIR, "android", "AndroidManifest.xml")
RES_DIR = os.path.join(BASE_DIR, "android", "app", "src", "main", "res")
JAVA_SRC_DIR = os.path.join(BASE_DIR, "android", "app", "src", "main", "java", "com", "manhunt", "gpsgame")

KEYSTORE = os.path.join(BASE_DIR, "manhunt-release.keystore")
KEY_ALIAS = "manhunt"
KEY_PASS = "manhunt2026"

FINAL_APK = os.path.join(BASE_DIR, "Manhunt.apk")

def run(cmd, desc):
    print(f"[*] {desc}...")
    res = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"[!] Error in {desc}:")
        print("STDOUT:", res.stdout)
        print("STDERR:", res.stderr)
        sys.exit(1)
    return res.stdout

def build_apk():
    os.makedirs(BUILD_DIR, exist_ok=True)
    compiled_res = os.path.join(BUILD_DIR, "compiled_res")
    os.makedirs(compiled_res, exist_ok=True)
    classes_dir = os.path.join(BUILD_DIR, "classes")
    os.makedirs(classes_dir, exist_ok=True)
    dex_dir = os.path.join(BUILD_DIR, "dex")
    os.makedirs(dex_dir, exist_ok=True)

    # 1. Compile individual resource files with aapt2
    print("[*] Compiling resources with aapt2...")
    for root, _, files in os.walk(RES_DIR):
        for f in files:
            full_path = os.path.join(root, f)
            cmd = f'"{AAPT2}" compile "{full_path}" -o "{compiled_res}"'
            run(cmd, f"Compiling {f}")
            
    # Find all compiled .flat files
    flat_files = glob.glob(os.path.join(compiled_res, "*.flat"))
    flats_arg = " ".join([f'"{f}"' for f in flat_files])

    # 2. Link resources with aapt2 link targeting modern Android 14 (API 34)
    unaligned_apk = os.path.join(BUILD_DIR, "base.apk")
    link_cmd = (
        f'"{AAPT2}" link -I "{ANDROID_JAR}" --manifest "{MANIFEST}" '
        f'--min-sdk-version 23 --target-sdk-version 34 '
        f'{flats_arg} -o "{unaligned_apk}" --auto-add-overlay'
    )
    run(link_cmd, "Linking APK resources with aapt2 (API 34 Target)")

    # 3. Compile Java source files
    java_files = [os.path.join(JAVA_SRC_DIR, f) for f in os.listdir(JAVA_SRC_DIR) if f.endswith(".java")]
    j_files_arg = " ".join([f'"{f}"' for f in java_files])
    javac_cmd = f'javac -cp "{ANDROID_JAR}" -d "{classes_dir}" {j_files_arg}'
    run(javac_cmd, "Compiling Java sources")

    # 4. Convert classes to DEX using D8
    class_files = []
    for root, _, files in os.walk(classes_dir):
        for f in files:
            if f.endswith(".class"):
                class_files.append(os.path.join(root, f))
    c_files_arg = " ".join([f'"{f}"' for f in class_files])
    d8_cmd = f'java -cp "{R8_JAR}" com.android.tools.r8.D8 --lib "{ANDROID_JAR}" --output "{dex_dir}" {c_files_arg}'
    run(d8_cmd, "D8 converting bytecode to classes.dex")

    # 5. Pack classes.dex and web assets into packaged.apk
    print("[*] Packing classes.dex and web assets into APK...")
    dex_file = os.path.join(dex_dir, "classes.dex")
    packaged_apk = os.path.join(BUILD_DIR, "packaged.apk")
    shutil.copyfile(unaligned_apk, packaged_apk)

    with zipfile.ZipFile(packaged_apk, "a", compression=zipfile.ZIP_DEFLATED) as z:
        z.write(dex_file, "classes.dex")

        # Web assets
        index_path = os.path.join(BASE_DIR, "index.html")
        with open(index_path, "r", encoding="utf-8") as f:
            index_content = f.read()

        apk_flag_script = (
            "<head>\n"
            "  <script>\n"
            "    window.IS_ANDROID_APK = true;\n"
            "    try { localStorage.setItem('manhunt_device_platform_v2', 'android'); } catch(e) {}\n"
            "  </script>"
        )
        index_content = index_content.replace("<head>", apk_flag_script, 1)
        z.writestr("assets/index.html", index_content.encode("utf-8"))

        web_files = [
            ("manifest.json", "assets/manifest.json"),
            ("privacy-policy.html", "assets/privacy-policy.html"),
            ("service-worker.js", "assets/service-worker.js")
        ]
        for src, dest in web_files:
            src_path = os.path.join(BASE_DIR, src)
            if os.path.exists(src_path):
                z.write(src_path, dest)

        # css/
        css_dir = os.path.join(BASE_DIR, "css")
        for f in os.listdir(css_dir):
            z.write(os.path.join(css_dir, f), f"assets/css/{f}")

        # js/
        js_dir = os.path.join(BASE_DIR, "js")
        for f in os.listdir(js_dir):
            z.write(os.path.join(js_dir, f), f"assets/js/{f}")

        # assets/
        assets_dir = os.path.join(BASE_DIR, "assets")
        for f in os.listdir(assets_dir):
            if not f.endswith(".py"):
                z.write(os.path.join(assets_dir, f), f"assets/assets/{f}")

    # 6. Ensure Keystore exists
    if not os.path.exists(KEYSTORE):
        print("[*] Generating production signing keystore...")
        key_cmd = (
            f'keytool -genkeypair -v -keystore "{KEYSTORE}" -alias {KEY_ALIAS} '
            f'-keyalg RSA -keysize 2048 -validity 10000 -storepass {KEY_PASS} -keypass {KEY_PASS} '
            f'-dname "CN=Manhunt, OU=Mobile, O=TacticalGame, L=SanFrancisco, ST=CA, C=US"'
        )
        run(key_cmd, "Creating signing keystore")

    # 7. ZipAlign APK (4-byte alignment mandatory for modern Android)
    aligned_apk = os.path.join(BUILD_DIR, "aligned.apk")
    if os.path.exists(aligned_apk):
        os.remove(aligned_apk)
    zipalign_cmd = f'"{ZIPALIGN}" -p -f 4 "{packaged_apk}" "{aligned_apk}"'
    run(zipalign_cmd, "4-byte ZipAligning APK for Android OS")

    # 8. Sign with official Android apksigner (v1, v2, and v3 signatures)
    if os.path.exists(FINAL_APK):
        os.remove(FINAL_APK)
    apksigner_cmd = (
        f'java -jar "{APKSIGNER}" sign --ks "{KEYSTORE}" --ks-key-alias {KEY_ALIAS} '
        f'--ks-pass pass:{KEY_PASS} --key-pass pass:{KEY_PASS} '
        f'--v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true '
        f'--out "{FINAL_APK}" "{aligned_apk}"'
    )
    run(apksigner_cmd, "Signing APK with Signature Scheme v1, v2 & v3 via apksigner")

    # 9. Verify APK Signature Scheme v2 & v3
    verify_cmd = f'java -jar "{APKSIGNER}" verify --verbose "{FINAL_APK}"'
    verify_out = run(verify_cmd, "Verifying APK Signature Scheme v2 & v3")
    print(verify_out.strip())

    print(f"\n======================================================")
    print(f"[SUCCESS] MODERN ANDROID 14+ PRODUCTION APK BUILT!")
    print(f"======================================================")
    print(f"  Location: {FINAL_APK}")
    print(f"  Size:     {os.path.getsize(FINAL_APK):,} bytes")
    print(f"======================================================\n")

if __name__ == "__main__":
    build_apk()
