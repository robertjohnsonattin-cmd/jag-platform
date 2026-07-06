---
name: prep-listing-photos
description: Convert HEIC photos to JPEG and downscale all photos in a folder for property/vehicle/asset listing uploads (MinIO storage via ManageListingModal, unit photos, item photos, etc). Use when the user has photos to upload for a listing and mentions HEIC files, wants to compress/downscale photos before upload, or asks to prep photos for a listing.
---

# Prep listing photos

Prepares a folder of phone photos (HEIC and/or JPEG) for upload to the JAG platform (unit listings, vehicle photos, item photos, etc). Two steps: convert HEIC → JPEG, then downscale everything to a web-friendly size.

## Why this is needed

- **HEIC won't render in the app.** Listing galleries and Facebook broadcast use a plain `<img src>` pointing at the MinIO-stored file (see `jag-api/src/routes/properties/listing.ts` — no server-side image conversion happens anywhere in the upload pipeline). HEIC only renders natively in Safari/iOS; Chrome/Edge/most Android browsers show a broken image icon. Must convert to JPEG before upload.
- **Phone photos are oversized for web use.** Samsung/iPhone originals are typically 3000px+ on the long edge and several MB each. Full-size uploads slow down gallery loads and the Facebook post crawler, and use more MinIO storage than needed.

## Steps

1. **Ask the user for the folder path** containing the photos (they typically sync/copy from phone to a Desktop folder first).
2. **List the folder** to see what's there (`Get-ChildItem <folder> | Select-Object Name, Length, Extension`) — confirm HEIC vs JPEG mix.
3. **Convert `.heic`/`.heif` to `.jpg` AND downscale in one pass, applying EXIF orientation.** Do NOT split conversion and downscaling into separate GDI+/WPF stages — GDI+ (`System.Drawing`) silently ignores the EXIF orientation tag when resizing, so a two-stage pipeline (WPF decode → GDI+ resize) bakes phone photos in sideways for any shot with `orientation != 1` (very common — portrait phone photos are usually tagged `6` or `8`, sensor data stored landscape). Do orientation + resize + encode all in WPF against the original HEIC so nothing round-trips through GDI+ first.

   Works because Windows' HEIF Image Extension codec, `Microsoft.HEIFImageExtension`, is installed — verify with `Get-AppxPackage -Name "*HEIF*"` if conversion fails. **Must run via `powershell.exe -sta -NoProfile -File <script>`** — running WPF imaging types inline in the default MTA PowerShell session throws `A constructor was not found` even though the assembly loads. Originals are left in place (non-destructive), new `.jpg` siblings are written/overwritten alongside them.

   ```powershell
   Add-Type -AssemblyName PresentationCore
   Add-Type -AssemblyName WindowsBase
   $folder = "<folder>"
   $maxDim = 1600

   function Get-Orientation($frame) {
       foreach ($p in @("/ifd/{ushort=274}", "/app1/ifd/{ushort=274}", "/ifd/exif/{ushort=274}")) {
           try { $v = $frame.Metadata.GetQuery($p); if ($v) { return [int]$v } } catch {}
       }
       return 1
   }

   foreach ($f in Get-ChildItem $folder -Filter *.heic) {
       $uri = New-Object System.Uri($f.FullName)
       $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create($uri, [System.Windows.Media.Imaging.BitmapCreateOptions]::None, [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad)
       $frame = $decoder.Frames[0]
       $orientation = Get-Orientation $frame

       $source = $frame
       $rt = switch ($orientation) { 3 { 180 } 6 { 90 } 8 { 270 } default { $null } }
       if ($rt) {
           $tb = New-Object System.Windows.Media.Imaging.TransformedBitmap
           $tb.BeginInit(); $tb.Source = $frame; $tb.Transform = (New-Object System.Windows.Media.RotateTransform($rt)); $tb.EndInit()
           $source = $tb
       }

       $scale = [Math]::Min(1.0, $maxDim / [Math]::Max($source.PixelWidth, $source.PixelHeight))
       if ($scale -lt 1.0) {
           $tb2 = New-Object System.Windows.Media.Imaging.TransformedBitmap
           $tb2.BeginInit(); $tb2.Source = $source; $tb2.Transform = (New-Object System.Windows.Media.ScaleTransform($scale, $scale)); $tb2.EndInit()
           $source = $tb2
       }

       $jpgPath = Join-Path $folder ($f.BaseName + ".jpg")
       $encoder = New-Object System.Windows.Media.Imaging.JpegBitmapEncoder
       $encoder.QualityLevel = 85
       $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($source))
       $fs = [System.IO.File]::Open($jpgPath, [System.IO.FileMode]::Create)
       $encoder.Save($fs); $fs.Close()
   }
   ```

4. **For pre-existing plain `.jpg` files** (not converted from HEIC), downscale with GDI+ as before, but first check `img.GetPropertyItem(0x0112)` for an EXIF orientation tag and apply `RotateFlip` accordingly before resizing — same rotation bug applies to native JPEGs from the phone, not just HEIC-derived ones.

   ```powershell
   Add-Type -AssemblyName System.Drawing
   $folder = "<folder>"
   $maxDim = 1600
   $jpegCodec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
   $encParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
   $encParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 85L)
   foreach ($f in Get-ChildItem $folder -Filter *.jpg) {
       $img = [System.Drawing.Image]::FromFile($f.FullName)
       if ($img.PropertyIdList -contains 0x0112) {
           $o = $img.GetPropertyItem(0x0112).Value[0]
           switch ($o) {
               3 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate180FlipNone) }
               6 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate90FlipNone) }
               8 { $img.RotateFlip([System.Drawing.RotateFlipType]::Rotate270FlipNone) }
           }
       }
       $scale = [Math]::Min(1.0, $maxDim / [Math]::Max($img.Width, $img.Height))
       $newW = [int][Math]::Round($img.Width * $scale); $newH = [int][Math]::Round($img.Height * $scale)
       $bmp = New-Object System.Drawing.Bitmap($newW, $newH)
       $g = [System.Drawing.Graphics]::FromImage($bmp)
       $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
       $g.DrawImage($img, 0, 0, $newW, $newH)
       $g.Dispose(); $img.Dispose()
       $bmp.Save($f.FullName, $jpegCodec, $encParams)
       $bmp.Dispose()
   }
   ```
   This step is destructive to the JPEGs (only run it on files that don't have an untouched HEIC original to fall back to) — only do it after the user confirms they want downscaling.

5. **Report results**: file count converted, size before/after, and flag any oddly-shaped images (e.g. panoramas/screenshots with extreme aspect ratios) that may not belong in the listing.
6. **Point the user back to the upload step** — for unit listings: Properties → [property] → Units → [unit] → Listing button → photo gallery upload (goes to MinIO `jag-photos` bucket via presigned PUT, see `POST /properties/units/:id/photos/upload-url`). For other asset types (vehicle/item photos), the equivalent Manage/Photos tab.

## Notes

- This runs entirely locally — files never leave the machine during conversion/downscaling; only the final upload (done by the user in-browser) sends them to MinIO.
- If `Microsoft.HEIFImageExtension` isn't installed (`Get-AppxPackage -Name "*HEIF*"` returns nothing), HEIC decoding will fail — tell the user to install "HEIF Image Extensions" from the Microsoft Store first.
- Don't delete the original HEIC files — leave them as a backup unless the user explicitly asks to clean up. This also means a botched downscale (e.g. the orientation bug below) can always be redone from source.
- **EXIF orientation bug (hit in practice, 2026-07-05):** never split conversion and resizing into a WPF-decode-then-GDI+-resize pipeline — GDI+ ignores the EXIF orientation tag, so any portrait phone photo (commonly tagged orientation 6 or 8, sensor data stored landscape) comes out rotated 90°. Always bake the rotation in during the same pass that does the resize (see scripts above), whether that's WPF (HEIC source) or GDI+ with `RotateFlip` (JPEG source). Files that were already overwritten by a broken pipeline can't be fixed retroactively if no untouched original remains — this is another reason to never delete source files until final output is verified.
- Wide/panorama-style images (e.g. an aspect ratio like 5:1) are not a rotation bug — flag them for the user to confirm they belong in the listing rather than "fixing" them.
