import os
from PIL import Image

def generate_android_res():
    base_dir = "C:/Users/H/Desktop/kyns-playground/useful/APKs/Manhunt/android/app/src/main/res"
    icon_src = "C:/Users/H/Desktop/kyns-playground/useful/APKs/Manhunt/assets/icon.png"
    
    densities = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192
    }
    
    img = Image.open(icon_src)
    for folder, size in densities.items():
        folder_path = os.path.join(base_dir, folder)
        os.makedirs(folder_path, exist_ok=True)
        
        # ic_launcher.png
        resized = img.resize((size, size), Image.Resampling.LANCZOS)
        resized.save(os.path.join(folder_path, "ic_launcher.png"), "PNG")
        resized.save(os.path.join(folder_path, "ic_launcher_round.png"), "PNG")
        print(f"Generated {folder}/ic_launcher.png ({size}x{size})")

generate_android_res()
