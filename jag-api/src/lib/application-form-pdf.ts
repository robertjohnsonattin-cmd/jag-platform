import PDFDocument from 'pdfkit';

export function generateApplicationFormPDF(): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: 20 });

  const margins = 20;
  const colWidth = 90;
  const smallFont = 7;
  const labelFont = 8;

  let y = 20;

  // Title
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#1a3a52').text('RENTAL APPLICATION', margins, y);
  y += 14;
  doc.fontSize(7).fillColor('#666').text('JAG Properties — Robert Johnson-Attin', margins, y);
  y += 10;

  // Helper to draw a small field
  function smallField(label: string, xPos: number, yPos: number, width = 75) {
    doc.fontSize(labelFont).fillColor('#333').text(label, xPos, yPos, { width: width, height: 10 });
    doc.rect(xPos, yPos + 9, width, 12).stroke();
    return yPos + 24;
  }

  // Section 1: Personal (3 columns)
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a3a52').text('APPLICANT', margins, y);
  y += 10;
  y = smallField('Name *', margins, y, 110);

  y -= 24;
  y = smallField('DOB *', margins + 115, y, 60);

  y -= 24;
  y = smallField('Phone *', margins + 180, y, 85);

  y = smallField('Email', margins, y, 110);
  y -= 24;
  y = smallField('National ID *', margins + 115, y, 60);
  y -= 24;
  y = smallField('Employment *', margins + 180, y, 85);

  // Section 2: Address (2 columns)
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a3a52').text('ADDRESS', margins, y);
  y += 10;
  y = smallField('Street *', margins, y, 130);
  y -= 24;
  y = smallField('City *', margins + 135, y, 115);

  // Section 3: Work (3 columns)
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a3a52').text('WORK', margins, y);
  y += 10;
  y = smallField('Employer', margins, y, 95);
  y -= 24;
  y = smallField('Title', margins + 100, y, 75);
  y -= 24;
  y = smallField('Income (TTD) *', margins + 180, y, 85);

  // Section 4: Household (4 columns)
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a3a52').text('HOUSEHOLD', margins, y);
  y += 10;

  doc.fontSize(labelFont).text('Adults *', margins, y);
  doc.rect(margins, y + 9, 35, 12).stroke();

  doc.fontSize(labelFont).text('Children', margins + 40, y);
  doc.rect(margins + 40, y + 9, 35, 12).stroke();

  doc.fontSize(labelFont).text('Pets? *', margins + 80, y);
  doc.fontSize(6).text('☐Yes ☐No', margins + 80, y + 10);

  doc.fontSize(labelFont).text('Move-in *', margins + 135, y);
  doc.rect(margins + 135, y + 9, 60, 12).stroke();

  y += 24;

  // Section 5: References (2 rows, compact)
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a3a52').text('REFERENCES', margins, y);
  y += 10;

  doc.fontSize(labelFont).text('Ref 1: Name / Phone / Relation *', margins, y);
  doc.rect(margins, y + 9, 255, 12).stroke();
  y += 24;

  doc.fontSize(labelFont).text('Ref 2 / Emergency: Name / Phone / Relation *', margins, y);
  doc.rect(margins, y + 9, 255, 12).stroke();
  y += 24;

  // Declarations (tiny text to fit on one page)
  doc.fontSize(6).fillColor('#333').text('☐ All information is true and complete  ☐ I consent to background check  ☐ No evictions/broken leases', margins, y);
  y += 10;

  doc.fontSize(6).text('Signature: ________________________  Date: __________', margins, y);

  return doc;
}
