# Schaalt een op 2x gerenderd beeld terug naar de eindmaat (scherpere randen).
import sys
from PIL import Image
src, out, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
Image.open(src).convert('RGB').resize((w, h), Image.LANCZOS).save(out, optimize=True)
