import math
from PIL import Image, ImageDraw, ImageFont

def create_app_icon():
    size = (512, 512)
    img = Image.new("RGBA", size, (10, 14, 20, 255))
    draw = ImageDraw.Draw(img)
    
    # Outer dark rounded rectangle or circular background
    cx, cy = 256, 256
    
    # Subtle gradient background circles
    for r in range(240, 20, -20):
        alpha = int(25 + (240 - r) * 0.15)
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(0, 229, 255, alpha), width=1)
        
    # Concentric tactical radar rings
    for r in [60, 120, 180, 230]:
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(0, 255, 170, 180), width=3)
        
    # Crosshair tactical lines
    draw.line([cx, 20, cx, 492], fill=(0, 255, 170, 160), width=2)
    draw.line([20, cy, 492, cy], fill=(0, 255, 170, 160), width=2)
    
    # Radar sweep beam wedge
    sweep = Image.new("RGBA", size, (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(sweep)
    sweep_angle_start = 280
    sweep_angle_end = 360
    for a in range(sweep_angle_start, sweep_angle_end):
        norm = (a - sweep_angle_start) / (sweep_angle_end - sweep_angle_start)
        rad = math.radians(a)
        x2 = cx + 225 * math.cos(rad)
        y2 = cy + 225 * math.sin(rad)
        alpha = int(norm * 140)
        sdraw.line([cx, cy, x2, y2], fill=(0, 255, 200, alpha), width=4)
    img = Image.alpha_composite(img, sweep)
    draw = ImageDraw.Draw(img)
    
    # Target Seekers & Runners blips
    # Seeker (Red/Orange crosshair blip)
    sx, sy = 180, 170
    draw.ellipse([sx-14, sy-14, sx+14, sy+14], fill=(255, 60, 70, 255), outline=(255, 200, 200, 255), width=2)
    draw.ellipse([sx-24, sy-24, sx+24, sy+24], outline=(255, 60, 70, 140), width=2)
    
    # Runner (Cyan/Emerald ping with pulse rings)
    rx, ry = 330, 310
    draw.ellipse([rx-14, ry-14, rx+14, ry+14], fill=(0, 255, 170, 255), outline=(255, 255, 255, 255), width=2)
    draw.ellipse([rx-30, ry-30, rx+30, ry+30], outline=(0, 255, 170, 160), width=3)
    draw.ellipse([rx-45, ry-45, rx+45, ry+45], outline=(0, 255, 170, 80), width=2)
    
    # Center radar hub
    draw.ellipse([cx-10, cy-10, cx+10, cy+10], fill=(0, 255, 220, 255))
    
    # Outer border
    draw.rounded_rectangle([12, 12, 500, 500], radius=110, outline=(0, 255, 170, 200), width=8)
    
    img.save("C:/Users/H/Desktop/kyns-playground/useful/APKs/Manhunt/assets/icon.png", "PNG")
    img.resize((64, 64), Image.Resampling.LANCZOS).save("C:/Users/H/Desktop/kyns-playground/useful/APKs/Manhunt/assets/favicon.png", "PNG")
    img.resize((192, 192), Image.Resampling.LANCZOS).save("C:/Users/H/Desktop/kyns-playground/useful/APKs/Manhunt/assets/icon-192.png", "PNG")
    print("Icon generated successfully.")

create_app_icon()
