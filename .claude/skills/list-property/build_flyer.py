"""
JAG Properties listing flyer generator — navy/gold branded, one-page PDF.

Usage: fill in the CONFIG block below for the unit being listed, then run:
    python build_flyer.py
Requires: pip install qrcode reportlab  (reportlab unused here but playwright needed)
    pip install playwright && playwright install chromium
Renders via a headless Chromium (Playwright) so real vector text + CSS gradients
come out crisp in the PDF — do not swap this for a rasterized-screenshot approach.
"""
import base64
import json
import os
import qrcode
from playwright.sync_api import sync_playwright

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG — edit this block per listing
# ─────────────────────────────────────────────────────────────────────────────

OUT_PDF = r"C:\Users\rober\Desktop\flyer_output\Listing_Flyer.pdf"

JAG_LOGO_PATH = r"C:\Users\rober\Documents\Claude\Projects\JAG Holdings\jag-web\public\jag-logo.png"

BOOKING_URL = "https://jagcorporate.com/book/REPLACE-WITH-SLUG"
WHATSAPP_NUMBER = "868-277-3726"     # WhatsApp-only booking/messaging line — do not word this as "no calls"
                                      # anymore; some prospects genuinely prefer to talk to someone
                                      # (learned 2026-07-24) — always pair it with CALL_NUMBER below.
CALL_NUMBER = "868-753-2637"         # for prospects who'd rather speak to someone directly

HERO_PHOTO = r"C:\path\to\hero.jpg"          # widest / brightest room, e.g. living area
BEDROOM_PHOTO = r"C:\path\to\bedroom.jpg"
BATHROOM_PHOTO = r"C:\path\to\bathroom.jpg"  # prefer a wide shot showing sink+shower+toilet
                                              # together over a close-up of one fixture —
                                              # crop a panorama if one exists (see notes below)
KITCHEN_PHOTO = r"C:\path\to\kitchen.jpg"

AREA_EYEBROW = "DIEGO MARTIN"                # small caps label over the hero title, usually the town/area
HERO_TITLE = "1-Bedroom Apartment"           # keep generic (no unit letter/number) unless asked otherwise

PRICE = "$2,800"
PRICE_UNIT = "TTD / month"

# 4 stat boxes — each is (icon_key, value, label). icon_key must be one of ICONS below.
STATS = [
    ("bed", "1", "BEDROOM"),
    ("bath", "1", "BATHROOM"),
    ("ruler", "482 sqft", "FLOOR AREA"),
    ("gate", "Gated", "YARD"),
]

DESCRIPTION = (
    "Bright and airy, unfurnished 1-bedroom apartment in a private 4-unit building on a quiet "
    "street. Features a large bedroom, private ensuite bathroom, and a generous open living/kitchen "
    "area with great natural light throughout. Perfect for a single professional or couple looking "
    "for space and security."
)

CHECKLIST = [
    "Fenced &amp; gated private yard for added security",
    "Off-street parking available on the property",
    "Water included",
    "Tenant responsible for electricity (separate meter) and internet, if desired",
]

LOCATION_LINE_BOLD = "Skinner Terrace, Diego Martin"   # omit street number unless asked to include it
LOCATION_LINE_REST = (
    "easy access to Port of Spain and the surrounding western corridor. Exact address given at viewing."
)

FOOTER_NOTE = (
    "Managed by JAG Properties on behalf of the Landlord. Serious enquiries only "
    "&mdash; deposit required to hold the unit."
)

# ─────────────────────────────────────────────────────────────────────────────
# Theme — JAG brand colors (navy + gold), extracted from jag-logo.png.
# Swap to the THEME_GREEN dict below only if the user explicitly asks for the
# old Apt-C1-style green instead of brand colors.
# ─────────────────────────────────────────────────────────────────────────────

THEME_NAVY_GOLD = dict(cream='#FBF6EC', accent='#A67942', accent_dark='#0A2946',
                        accent_light='#D4B483', stat_bg='#F1E7D6')
THEME_GREEN = dict(cream='#FBF6EC', accent='#B5502E', accent_dark='#1B5852',
                    accent_light='#8FBFB4', stat_bg='#F1E7D6')
THEME = THEME_NAVY_GOLD

# ─────────────────────────────────────────────────────────────────────────────
# Icon library (flat line SVGs, 24x24 viewBox, stroke=currentColor via CSS)
# ─────────────────────────────────────────────────────────────────────────────

ICONS = {
    "bed": '<path d="M2 18v-6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v6"/><path d="M2 18v2M22 18v2"/><path d="M4 10V7a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3"/><path d="M13 10V8a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2"/>',
    "bath": '<path d="M4 12h16v3a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-3Z"/><path d="M7 12V6a2 2 0 0 1 3.6-1.2"/><path d="M4 19v1M18 19v1"/>',
    "ruler": '<rect x="3" y="8" width="18" height="8" rx="1"/><path d="M7 8v3M11 8v3M15 8v3M19 8v3"/>',
    "gate": '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    "drop": '<path d="M12 2s7 8 7 13a7 7 0 1 1-14 0c0-5 7-13 7-13Z"/>',
    "car": '<path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11"/><rect x="3" y="11" width="18" height="6" rx="2"/><circle cx="7.5" cy="17.5" r="1.2"/><circle cx="16.5" cy="17.5" r="1.2"/>',
    "home": '<path d="M4 11 12 4l8 7"/><path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9"/>',
}

PIN_SVG = '<path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z"/><circle cx="12" cy="9" r="2.3"/>'
WHATSAPP_SVG = '<path d="M16.001 3C9.096 3 3.5 8.597 3.5 15.501c0 2.37.656 4.586 1.795 6.478L3 29l7.207-2.256a12.44 12.44 0 0 0 5.794 1.437h.005c6.905 0 12.5-5.597 12.5-12.501C28.506 8.775 22.906 3 16.001 3Zm7.34 17.813c-.313.88-1.55 1.612-2.542 1.826-.677.144-1.561.26-4.537-.975-3.808-1.578-6.258-5.448-6.448-5.7-.183-.253-1.534-2.041-1.534-3.894 0-1.853.972-2.762 1.317-3.14.283-.311.752-.454 1.202-.454.145 0 .276.007.394.013.345.014.518.033.746.578.283.68.972 2.344 1.056 2.516.084.172.14.373.028.6-.104.234-.157.379-.31.583-.157.203-.328.454-.469.61-.157.171-.32.359-.137.665.183.303.813 1.34 1.746 2.171 1.199 1.069 2.21 1.4 2.518 1.556.309.157.487.132.667-.08.183-.213.383-.354.577-.59.194-.235.099-.442-.021-.618-.121-.176-1.1-.264-1.226Z"/>'
PHONE_SVG = '<path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>'

# ─────────────────────────────────────────────────────────────────────────────
# Build
# ─────────────────────────────────────────────────────────────────────────────

def b64(path):
    ext = 'png' if path.lower().endswith('png') else 'jpeg'
    with open(path, 'rb') as f:
        return f'data:image/{ext};base64,' + base64.b64encode(f.read()).decode()

def make_qr(url, out_path):
    qr = qrcode.QRCode(box_size=8, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    qr.make_image(fill_color="black", back_color="white").save(out_path)
    return out_path

os.makedirs(os.path.dirname(OUT_PDF), exist_ok=True)
qr_path = os.path.join(os.path.dirname(OUT_PDF), '_qr.png')
make_qr(BOOKING_URL, qr_path)

IMG = dict(
    logo=b64(JAG_LOGO_PATH), hero=b64(HERO_PHOTO), bedroom=b64(BEDROOM_PHOTO),
    bathroom=b64(BATHROOM_PHOTO), kitchen=b64(KITCHEN_PHOTO), qr=b64(qr_path),
)

stats_html = "\n".join(
    f'''<div class="stat">
      <div class="icon"><svg viewBox="0 0 24 24">{ICONS[icon]}</svg></div>
      <div class="val">{val}</div><div class="lbl">{lbl}</div>
    </div>''' for icon, val, lbl in STATS
)
checklist_html = "\n".join(f"<li>{item}</li>" for item in CHECKLIST)

TEMPLATE = """<!doctype html>
<html><head><meta charset="utf-8"><style>
  @page {{ size: Letter; margin: 0; }}
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  body {{ width: 816px; background: {cream}; font-family: 'Segoe UI', Arial, sans-serif;
          color: #2a2420; padding: 18px 42px 14px; }}
  .topbar {{ display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;
             padding-bottom: 10px; border-bottom: 3px solid {accent}; }}
  .logo-row {{ display: flex; align-items: center; gap: 10px; }}
  .logo-row img {{ height: 40px; }}
  .logo-row .name {{ font-size: 15px; font-weight: 700; letter-spacing: 1px; color: {accent_dark}; }}
  .badge {{ background: {accent}; color: white; font-size: 12px; font-weight: 700; letter-spacing: 1px;
            padding: 8px 16px; border-radius: 6px; box-shadow: 0 2px 6px rgba(166,121,66,0.4); }}
  .hero-wrap {{ position: relative; border-radius: 10px; overflow: hidden; }}
  .hero-wrap img {{ width: 100%; height: 188px; object-fit: cover; display: block; }}
  .hero-overlay {{ position: absolute; left: 0; right: 0; bottom: 0;
                   background: linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0)); padding: 34px 24px 14px; }}
  .hero-eyebrow {{ color: {accent_light}; font-size: 12px; font-weight: 700; letter-spacing: 2px; }}
  .hero-title {{ color: white; font-size: 28px; font-weight: 800; margin-top: 2px; }}
  .price-bar {{ background: {accent_dark}; color: white; display: flex; align-items: center; justify-content: space-between;
                padding: 13px 24px; border-radius: 8px; margin-top: 10px; }}
  .price-bar .price {{ font-size: 24px; font-weight: 800; }}
  .price-bar .price span {{ font-size: 13px; font-weight: 500; opacity: 0.85; }}
  .stats {{ display: flex; gap: 12px; margin-top: 12px; }}
  .stat {{ flex: 1; background: {stat_bg}; border-radius: 10px; padding: 11px 8px 10px; text-align: center;
           border-top: 3px solid {accent}; }}
  .stat .icon {{ margin-bottom: 6px; display: flex; justify-content: center; }}
  .stat .icon svg {{ width: 22px; height: 22px; stroke: {accent_dark}; fill: none; stroke-width: 1.8; }}
  .stat .val {{ font-size: 17px; font-weight: 800; color: #2a2420; }}
  .stat .lbl {{ font-size: 9.5px; letter-spacing: 0.5px; color: #7a6f63; font-weight: 600; margin-top: 1px; }}
  .desc {{ font-size: 13px; line-height: 1.5; margin-top: 12px; color: #3a332c; }}
  .section-head {{ color: {accent}; font-size: 12px; font-weight: 800; letter-spacing: 1.5px; margin-top: 12px; margin-bottom: 6px; }}
  .checklist {{ list-style: none; }}
  .checklist li {{ font-size: 12.5px; margin-bottom: 2px; padding-left: 22px; position: relative; color: #3a332c; }}
  .checklist li:before {{ content: "\\2713"; position: absolute; left: 0; color: {accent}; font-weight: 800; }}
  .photo-strip {{ display: flex; gap: 10px; margin-top: 6px; }}
  .photo-strip .ph {{ flex: 1; position: relative; border-radius: 8px; overflow: hidden; height: 105px; }}
  .photo-strip .ph img {{ width: 100%; height: 100%; object-fit: cover; display: block; }}
  .photo-strip .cap {{ position: absolute; left: 8px; bottom: 6px; color: white; font-size: 11px; font-weight: 700;
                        text-shadow: 0 1px 3px rgba(0,0,0,0.8); }}
  .locbox {{ margin-top: 12px; border: 1.5px dashed {accent}; border-radius: 8px; padding: 10px 16px; font-size: 12.5px;
             color: #3a332c; display: flex; gap: 10px; align-items: flex-start; }}
  .locbox .pin svg {{ width: 16px; height: 16px; stroke: {accent_dark}; fill: none; stroke-width: 2; margin-top: 1px; }}
  .cta {{ margin-top: 10px; background: {accent_dark}; border-radius: 10px; padding: 13px 24px; color: white;
          display: flex; align-items: center; justify-content: space-between; gap: 20px;
          border-left: 5px solid {accent}; }}
  .cta .left {{ flex: 1; }}
  .cta .eyebrow {{ font-size: 11px; letter-spacing: 1.5px; color: {accent_light}; font-weight: 700; }}
  .cta .contact-row {{ display: flex; align-items: center; gap: 8px; margin: 3px 0 1px; }}
  .cta .contact-row svg {{ width: 17px; height: 17px; flex-shrink: 0; }}
  .cta .contact-row.whatsapp svg {{ fill: #25D366; }}
  .cta .contact-row.call svg {{ fill: {accent_light}; }}
  .cta .phone {{ font-size: 19px; font-weight: 800; }}
  .cta .contact-sub {{ font-size: 10px; color: {accent_light}; font-weight: 600; margin-bottom: 5px; }}
  .cta .link-box {{ background: white; color: {accent_dark}; font-weight: 700; font-size: 12.5px;
                     border-radius: 6px; padding: 8px 14px; display: inline-block; }}
  .cta .qr {{ background: white; padding: 6px; border-radius: 8px; }}
  .cta .qr img {{ width: 66px; height: 66px; display: block; }}
  .footer-note {{ text-align: center; font-size: 10.5px; color: #8a8074; margin-top: 10px; }}
</style></head><body>

  <div class="topbar">
    <div class="logo-row"><img src="{logo}"><span class="name">JAG PROPERTIES</span></div>
    <div class="badge">FOR RENT</div>
  </div>

  <div class="hero-wrap">
    <img src="{hero}">
    <div class="hero-overlay">
      <div class="hero-eyebrow">{area_eyebrow}</div>
      <div class="hero-title">{hero_title}</div>
    </div>
  </div>

  <div class="price-bar"><div class="price">{price} <span>{price_unit}</span></div></div>

  <div class="stats">{stats_html}</div>

  <div class="desc">{description}</div>

  <div class="section-head">WHAT YOU'LL GET</div>
  <ul class="checklist">{checklist_html}</ul>

  <div class="section-head">A CLOSER LOOK</div>
  <div class="photo-strip">
    <div class="ph"><img src="{bedroom}"><div class="cap">Bedroom</div></div>
    <div class="ph"><img src="{bathroom}"><div class="cap">Bathroom</div></div>
    <div class="ph"><img src="{kitchen}"><div class="cap">Kitchen</div></div>
  </div>

  <div class="locbox">
    <div class="pin"><svg viewBox="0 0 24 24">{pin_svg}</svg></div>
    <div><b>{location_bold}</b> &mdash; {location_rest}</div>
  </div>

  <div class="cta">
    <div class="left">
      <div class="eyebrow">READY TO VIEW IT?</div>
      <div class="contact-row whatsapp"><svg viewBox="0 0 32 32">{whatsapp_svg}</svg><div class="phone">{whatsapp}</div></div>
      <div class="contact-sub">WhatsApp to message us &amp; book a viewing</div>
      <div class="contact-row call"><svg viewBox="0 0 24 24">{phone_svg}</svg><div class="phone">{call_number}</div></div>
      <div class="contact-sub">Prefer to talk to someone directly? Call for further information</div>
      <div class="link-box">{booking_url_display}</div>
    </div>
    <div class="qr"><img src="{qr}"></div>
  </div>

  <div class="footer-note">{footer_note}</div>

</body></html>
"""

html = TEMPLATE.format(
    **THEME, **IMG,
    area_eyebrow=AREA_EYEBROW, hero_title=HERO_TITLE,
    price=PRICE, price_unit=PRICE_UNIT,
    stats_html=stats_html, description=DESCRIPTION, checklist_html=checklist_html,
    pin_svg=PIN_SVG, location_bold=LOCATION_LINE_BOLD, location_rest=LOCATION_LINE_REST,
    whatsapp_svg=WHATSAPP_SVG, whatsapp=WHATSAPP_NUMBER,
    phone_svg=PHONE_SVG, call_number=CALL_NUMBER,
    booking_url_display=BOOKING_URL.replace('https://', ''),
    footer_note=FOOTER_NOTE,
)

html_path = os.path.join(os.path.dirname(OUT_PDF), '_flyer.html')
with open(html_path, 'w', encoding='utf-8') as f:
    f.write(html)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto('file:///' + html_path.replace('\\', '/'))
    page.wait_for_timeout(200)
    page.pdf(path=OUT_PDF, format='Letter', print_background=True,
             margin={'top': '0', 'bottom': '0', 'left': '0', 'right': '0'})
    browser.close()

print('Saved:', OUT_PDF)
print('NOTE: verify it is exactly 1 page (open the PDF or check with PyMuPDF/fitz).')
print('If it overflowed to 2 pages, trim spacing (see SKILL.md "Fitting to one page").')
