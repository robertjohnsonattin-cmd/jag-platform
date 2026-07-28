import PDFDocument from 'pdfkit';

export function generateApplicationFormPDF(): InstanceType<typeof PDFDocument> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margins = 40;
  const contentWidth = pageWidth - 2 * margins;

  // Helper: Draw a form field (label + box)
  function formField(y: number, label: string, isLarge = false, isCheckbox = false) {
    const labelHeight = 14;
    const boxHeight = isLarge ? 60 : 20;
    const spacing = 4;

    doc.fontSize(9).fillColor('#333333').text(label, margins, y);

    if (isCheckbox) {
      doc.rect(margins, y + labelHeight + spacing, 15, 15).stroke();
    } else {
      doc.rect(margins, y + labelHeight + spacing, contentWidth, boxHeight).stroke();
    }

    return y + labelHeight + spacing + boxHeight + 12;
  }

  // Header
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#1a3a52').text('RENTAL APPLICATION FORM', margins, 25, { width: contentWidth, align: 'center' });
  doc.fontSize(10).font('Helvetica').fillColor('#666666').text('JAG Properties — Robert Johnson-Attin', margins, 50, { width: contentWidth, align: 'center' });

  let yPos = 70;

  // Section 1: Applicant Information
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a3a52').text('SECTION 1: APPLICANT INFORMATION', margins, yPos);
  yPos += 20;

  yPos = formField(yPos, 'Full Name (As it appears on National ID) *');
  yPos = formField(yPos, 'Date of Birth (YYYY-MM-DD) *');

  // Two columns: National ID and Email
  doc.fontSize(9).fillColor('#333333').text('National ID / Passport Number *', margins, yPos);
  doc.rect(margins, yPos + 14, contentWidth / 2 - 8, 20).stroke();
  doc.fontSize(9).fillColor('#333333').text('Email Address', margins + contentWidth / 2 + 8, yPos);
  doc.rect(margins + contentWidth / 2 + 8, yPos + 14, contentWidth / 2 - 8, 20).stroke();
  yPos += 46;

  // Two columns: Phone
  doc.fontSize(9).fillColor('#333333').text('Phone Number (WhatsApp) *', margins, yPos);
  doc.rect(margins, yPos + 14, contentWidth / 2 - 8, 20).stroke();
  doc.fontSize(9).fillColor('#333333').text('Alternative Phone', margins + contentWidth / 2 + 8, yPos);
  doc.rect(margins + contentWidth / 2 + 8, yPos + 14, contentWidth / 2 - 8, 20).stroke();
  yPos += 46;

  // Section 2: Current Address
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a3a52').text('SECTION 2: CURRENT ADDRESS', margins, yPos);
  yPos += 20;

  yPos = formField(yPos, 'Current Street Address *');
  yPos = formField(yPos, 'City / Area *');

  // Section 3: Employment & Income
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a3a52').text('SECTION 3: EMPLOYMENT & INCOME', margins, yPos);
  yPos += 20;

  doc.fontSize(9).fillColor('#333333').text('Employment Status *', margins, yPos);
  const emptyBox = '☐';
  doc.fontSize(8).text(`${emptyBox} Employed    ${emptyBox} Self-Employed    ${emptyBox} Contract    ${emptyBox} Retired    ${emptyBox} Unemployed    ${emptyBox} Other`, margins, yPos + 14);
  yPos += 35;

  yPos = formField(yPos, 'Employer Name');
  yPos = formField(yPos, 'Job Title / Occupation');
  yPos = formField(yPos, 'Work Address');
  yPos = formField(yPos, 'Work Telephone');
  yPos = formField(yPos, 'Monthly Income (TTD) *');

  // Section 4: Household Information
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a3a52').text('SECTION 4: HOUSEHOLD INFORMATION', margins, yPos);
  yPos += 20;

  doc.fontSize(9).fillColor('#333333').text('Number of Adults *', margins, yPos);
  doc.rect(margins, yPos + 14, 80, 20).stroke();
  doc.fontSize(9).fillColor('#333333').text('Number of Children', margins + 100, yPos);
  doc.rect(margins + 100, yPos + 14, 80, 20).stroke();
  yPos += 46;

  doc.fontSize(9).fillColor('#333333').text('Do you have pets? *');
  doc.fontSize(8).text(`${emptyBox} Yes    ${emptyBox} No`, margins, yPos + 14);
  yPos += 30;

  yPos = formField(yPos, 'If yes, describe pets (type, size, number)');

  doc.fontSize(9).fillColor('#333333').text('Are you a smoker? *');
  doc.fontSize(8).text(`${emptyBox} Yes    ${emptyBox} No`, margins, yPos + 14);
  yPos += 30;

  // Section 5: References
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a3a52').text('SECTION 5: REFERENCES', margins, yPos);
  yPos += 20;

  doc.fontSize(9).fillColor('#666666').text('Reference 1 (Personal or Professional)', margins, yPos);
  yPos += 12;
  doc.fontSize(8).fillColor('#333333').text('Name: ___________________________     Relation: _______________     Phone: _______________', margins, yPos);
  yPos += 20;

  doc.fontSize(9).fillColor('#666666').text('Reference 2 (Personal or Professional)', margins, yPos);
  yPos += 12;
  doc.fontSize(8).fillColor('#333333').text('Name: ___________________________     Relation: _______________     Phone: _______________', margins, yPos);
  yPos += 20;

  doc.fontSize(9).fillColor('#666666').text('Prior Landlord (if applicable)', margins, yPos);
  yPos += 12;
  doc.fontSize(8).fillColor('#333333').text('Name: ___________________________     Phone: ___________________________', margins, yPos);
  yPos += 25;

  // Section 6: Tenancy Details
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a3a52').text('SECTION 6: TENANCY DETAILS', margins, yPos);
  yPos += 20;

  doc.fontSize(9).fillColor('#333333').text('Proposed Move-in Date (YYYY-MM-DD) *', margins, yPos);
  doc.rect(margins, yPos + 14, contentWidth / 2 - 8, 20).stroke();
  doc.fontSize(9).fillColor('#333333').text('Reason for Moving *', margins + contentWidth / 2 + 8, yPos);
  doc.rect(margins + contentWidth / 2 + 8, yPos + 14, contentWidth / 2 - 8, 20).stroke();
  yPos += 46;

  yPos = formField(yPos, 'Additional Comments', true);

  // Section 7: Declarations
  doc.fontSize(11).font('Helvetica-Bold').fillColor('#1a3a52').text('SECTION 7: DECLARATIONS', margins, yPos);
  yPos += 20;

  doc.fontSize(8).fillColor('#333333').text(`${emptyBox} I certify that all information provided in this application is true and complete.`, margins, yPos);
  yPos += 18;

  doc.fontSize(8).fillColor('#333333').text(`${emptyBox} I consent to a background check and rental history verification.`, margins, yPos);
  yPos += 18;

  doc.fontSize(8).fillColor('#333333').text(`${emptyBox} I have not been evicted or had a broken lease in the past 5 years.`, margins, yPos);
  yPos += 25;

  // Signature
  doc.fontSize(9).fillColor('#333333').text('Applicant Signature: ___________________________     Date: _______________', margins, yPos);
  yPos += 30;

  // Footer
  doc.fontSize(8).fillColor('#999999').text('Please ensure all required fields (*) are completed before submission.', margins, pageHeight - 50, { width: contentWidth, align: 'center' });
  doc.fontSize(7).fillColor('#cccccc').text('JAG Properties Rental Application — ' + new Date().toLocaleDateString('en-TT'), margins, pageHeight - 30, { width: contentWidth, align: 'center' });

  return doc;
}
