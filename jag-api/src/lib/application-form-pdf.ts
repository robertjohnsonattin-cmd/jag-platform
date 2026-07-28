import PDFDocument from 'pdfkit';

export function generateApplicationFormPDF(): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: 30 });

  const pageWidth = doc.page.width;
  const margins = 30;
  const contentWidth = pageWidth - 2 * margins;

  // Compact field helper
  function field(y: number, label: string, width = contentWidth, height = 16) {
    doc.fontSize(8).fillColor('#333').text(label, margins, y);
    doc.rect(margins, y + 12, width, height).stroke();
    return y + height + 20;
  }

  // Two-column field
  function twoColField(y: number, label1: string, label2: string) {
    const colWidth = (contentWidth - 8) / 2;
    doc.fontSize(8).fillColor('#333').text(label1, margins, y);
    doc.rect(margins, y + 12, colWidth, 16).stroke();
    doc.fontSize(8).fillColor('#333').text(label2, margins + colWidth + 8, y);
    doc.rect(margins + colWidth + 8, y + 12, colWidth, 16).stroke();
    return y + 36;
  }

  // Header
  doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a3a52').text('RENTAL APPLICATION', margins, 20);
  doc.fontSize(8).fillColor('#666').text('JAG Properties — Robert Johnson-Attin', margins, 36);

  let yPos = 50;

  // Applicant Info (compact)
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a3a52').text('APPLICANT INFORMATION', margins, yPos);
  yPos += 14;

  yPos = field(yPos, 'Full Name *');
  yPos = twoColField(yPos, 'Date of Birth *', 'National ID *');
  yPos = twoColField(yPos, 'Phone (WhatsApp) *', 'Email');

  // Current Address (compact)
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a3a52').text('CURRENT ADDRESS', margins, yPos);
  yPos += 14;
  yPos = field(yPos, 'Street Address *');
  yPos = twoColField(yPos, 'City *', 'Postal Code');

  // Employment (compact)
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a3a52').text('EMPLOYMENT & INCOME', margins, yPos);
  yPos += 14;

  doc.fontSize(8).fillColor('#333').text('Employment Status *', margins, yPos);
  doc.fontSize(7).text('☐ Employed  ☐ Self-Emp  ☐ Retired  ☐ Other', margins + 80, yPos);
  yPos += 18;

  yPos = twoColField(yPos, 'Employer Name', 'Job Title *');
  yPos = twoColField(yPos, 'Monthly Income (TTD) *', 'Work Phone');

  // Household (compact)
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a3a52').text('HOUSEHOLD', margins, yPos);
  yPos += 14;

  doc.fontSize(8).fillColor('#333').text('Adults', margins, yPos);
  doc.rect(margins, yPos + 12, 40, 16).stroke();
  doc.fontSize(8).text('Children', margins + 48, yPos);
  doc.rect(margins + 48, yPos + 12, 40, 16).stroke();
  doc.fontSize(8).text('Pets?', margins + 96, yPos);
  doc.fontSize(7).text('☐ Yes ☐ No', margins + 96, yPos + 13);
  yPos += 36;

  doc.fontSize(8).fillColor('#333').text('Smoker?', margins, yPos);
  doc.fontSize(7).text('☐ Yes ☐ No', margins + 40, yPos);
  doc.fontSize(8).text('Move-in Date *', margins + 100, yPos);
  doc.rect(margins + 140, yPos + 12, 90, 16).stroke();
  yPos += 36;

  // References (compact - 1 column only)
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a3a52').text('REFERENCES & EMERGENCY', margins, yPos);
  yPos += 14;

  yPos = field(yPos, 'Reference 1: Name / Phone / Relation *', contentWidth, 14);
  yPos = field(yPos, 'Reference 2: Name / Phone / Relation *', contentWidth, 14);
  yPos = field(yPos, 'Emergency Contact: Name / Phone / Relation *', contentWidth, 14);

  // Declarations (compact)
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#1a3a52').text('DECLARATIONS', margins, yPos);
  yPos += 14;

  doc.fontSize(7).fillColor('#333').text('☐ I certify all information is true and complete.', margins, yPos);
  yPos += 12;
  doc.fontSize(7).text('☐ I consent to background/rental history verification.', margins, yPos);
  yPos += 12;
  doc.fontSize(7).text('☐ I have not been evicted or broken a lease in past 5 years.', margins, yPos);
  yPos += 18;

  doc.fontSize(8).fillColor('#333').text('Signature: _____________________________     Date: __________', margins, yPos);

  return doc;
}
