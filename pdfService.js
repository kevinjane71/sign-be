const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

class PDFService {
  constructor() {
    console.log('📄 PDF Service initialized');
  }

  /**
   * Check if a file is a PDF
   */
  isPDF(buffer) {
    return buffer.slice(0, 4).toString() === '%PDF';
  }

  /**
   * Convert image to PDF
   */
  async imageToPDF(imageBuffer) {
    try {
      console.log('🖼️ Converting image to PDF...');
      const pdfDoc = await PDFDocument.create();
      
      // Determine image type and embed
      let image;
      const header = imageBuffer.slice(0, 10);
      
      if (header[0] === 0xFF && header[1] === 0xD8) {
        // JPEG
        image = await pdfDoc.embedJpg(imageBuffer);
      } else if (header.slice(0, 8).toString() === '\x89PNG\r\n\x1a\n') {
        // PNG
        image = await pdfDoc.embedPng(imageBuffer);
      } else {
        throw new Error('Unsupported image format. Only JPEG and PNG are supported.');
      }

      // Calculate page size to fit image
      const { width, height } = image;
      const maxWidth = 595; // A4 width in points
      const maxHeight = 842; // A4 height in points
      
      let pageWidth = width;
      let pageHeight = height;
      
      // Scale down if image is too large
      if (width > maxWidth || height > maxHeight) {
        const scale = Math.min(maxWidth / width, maxHeight / height);
        pageWidth = width * scale;
        pageHeight = height * scale;
      }

      const page = pdfDoc.addPage([pageWidth, pageHeight]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });

      const pdfBytes = await pdfDoc.save();
      console.log('✅ Image converted to PDF successfully');
      return Buffer.from(pdfBytes);
    } catch (error) {
      console.error('❌ Image to PDF conversion error:', error);
      throw new Error(`Failed to convert image to PDF: ${error.message}`);
    }
  }

  /**
   * Add form fields to PDF based on document fields
   */
  async addFieldsToPDF(pdfDoc, documentData, signerData) {
    try {
      console.log('📝 Adding form fields to PDF...');
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const pages = pdfDoc.getPages();
      
      // Get all fields from document (multi-file or single-file)
      let allFields = [];
      
      if (documentData.files && documentData.files.length > 0) {
        // Multi-file document - collect fields from all files
        documentData.files.forEach((file, fileIndex) => {
          if (file.fields && file.fields.length > 0) {
            file.fields.forEach(field => {
              allFields.push({
                ...field,
                fileIndex: fileIndex, // Map field to specific file/page
                documentIndex: fileIndex
              });
            });
          }
        });
      } else {
        // Legacy single-file document
        if (documentData.fields && documentData.fields.length > 0) {
          allFields = documentData.fields.map(field => ({
            ...field,
            fileIndex: 0,
            documentIndex: 0
          }));
        }
      }
      
      if (allFields.length === 0) {
        console.log('ℹ️ No fields to add to PDF');
        return pdfDoc;
      }

      console.log(`📋 Processing ${allFields.length} fields for PDF embedding`);

      // Group fields by file/page index
      const fieldsByPage = {};
      allFields.forEach(field => {
        const pageIndex = field.fileIndex || field.documentIndex || 0;
        if (!fieldsByPage[pageIndex]) {
          fieldsByPage[pageIndex] = [];
        }
        fieldsByPage[pageIndex].push(field);
      });

      // Process fields for each page
      for (const pageIndexStr of Object.keys(fieldsByPage)) {
        const pageIndex = parseInt(pageIndexStr);
        const pageFields = fieldsByPage[pageIndex];
        
        if (pageIndex >= pages.length) {
          console.warn(`⚠️ Page ${pageIndex} not found in PDF (total pages: ${pages.length})`);
          continue;
        }

        const page = pages[pageIndex];
        const { width: pageWidth, height: pageHeight } = page.getSize();
        
        console.log(`📄 Processing page ${pageIndex}: ${pageFields.length} fields, page size: ${pageWidth}x${pageHeight}`);
        
        for (const field of pageFields) {
          const signerFieldData = signerData.fieldValues?.[field.id];
          
          if (!signerFieldData || signerFieldData === '') {
            console.log(`⏭️ Skipping empty field: ${field.id}`);
            continue; // Skip empty fields
          }

          console.log(`🔧 Processing field: ${field.id} (${field.type}) = ${signerFieldData}`);

          // Calculate field coordinates
          let x, y, width, height;
          
          if (field.leftPercent !== undefined && field.topPercent !== undefined) {
            // New percentage-based coordinates
            x = (field.leftPercent / 100) * pageWidth;
            y = pageHeight - ((field.topPercent / 100) * pageHeight) - ((field.heightPercent / 100) * pageHeight); // PDF coordinates are bottom-up
            width = (field.widthPercent / 100) * pageWidth;
            height = (field.heightPercent / 100) * pageHeight;
          } else if (field.x !== undefined && field.y !== undefined) {
            // Legacy pixel-based coordinates
            const originalWidth = field.originalWidth || pageWidth;
            const originalHeight = field.originalHeight || pageHeight;
            
            const scaleX = pageWidth / originalWidth;
            const scaleY = pageHeight / originalHeight;
            
            x = field.x * scaleX;
            y = pageHeight - (field.y * scaleY) - (field.height * scaleY); // PDF coordinates are bottom-up
            width = field.width * scaleX;
            height = field.height * scaleY;
          } else {
            console.warn(`⚠️ Field ${field.id} has no valid coordinates`);
            continue;
          }

          console.log(`📍 Field coordinates: x=${x.toFixed(2)}, y=${y.toFixed(2)}, w=${width.toFixed(2)}, h=${height.toFixed(2)}`);

          // Render field based on type
          switch (field.type) {
            case 'text':
            case 'name':
            case 'email':
            case 'phone':
            case 'date':
              // Add text field
              const fontSize = Math.max(8, Math.min(height * 0.6, 14)); // Scale font size appropriately
              const textValue = signerFieldData.toString();
              
              console.log(`✏️ Adding text: "${textValue}" (font size: ${fontSize})`);
              
              page.drawText(textValue, {
                x: x + 2,
                y: y + (height / 2) - (fontSize / 2),
                size: fontSize,
                font: font,
                color: rgb(0, 0, 0),
                maxWidth: width - 4,
              });
              break;

            case 'checkbox':
              // Draw checkbox
              if (signerFieldData === true || signerFieldData === 'true') {
                const checkSize = Math.min(width, height) * 0.8;
                const checkX = x + (width - checkSize) / 2;
                const checkY = y + (height - checkSize) / 2;
                
                console.log(`☑️ Adding checkbox (checked)`);
                
                // Draw check mark (use 'X' instead of '✓' for WinAnsi compatibility)
                page.drawText('X', {
                  x: checkX,
                  y: checkY,
                  size: checkSize,
                  font: font,
                  color: rgb(0, 0, 0),
                });
              } else {
                console.log(`☐ Skipping unchecked checkbox`);
              }
              break;

            case 'signature':
            case 'initial':
              // Handle signature/initial image or text
              if (signerFieldData && signerFieldData.startsWith('data:image/')) {
                try {
                  console.log(`🖋️ Adding signature/initial image`);
                  // Extract base64 data
                  const base64Data = signerFieldData.split(',')[1];
                  const imageBuffer = Buffer.from(base64Data, 'base64');
                  // Embed image
                  let signatureImage;
                  if (signerFieldData.includes('data:image/png')) {
                    signatureImage = await pdfDoc.embedPng(imageBuffer);
                  } else {
                    signatureImage = await pdfDoc.embedJpg(imageBuffer);
                  }
                  // Draw signature
                  page.drawImage(signatureImage, {
                    x: x,
                    y: y,
                    width: width,
                    height: height,
                  });
                } catch (sigError) {
                  console.error('❌ Signature embedding error:', sigError);
                  // Fallback to text
                  const fallbackText = field.type === 'initial' ? 'Initialed' : 'Signed';
                  page.drawText(fallbackText, {
                    x: x + 2,
                    y: y + (height / 2),
                    size: Math.min(height * 0.6, 12),
                    font: font,
                    color: rgb(0, 0, 0),
                  });
                }
              } else if (signerFieldData) {
                // Text-based signature/initial
                console.log(`✍️ Adding text signature/initial: "${signerFieldData}"`);
                const fontSize = Math.max(8, Math.min(height * 0.6, 14));
                page.drawText(signerFieldData.toString(), {
                  x: x + 2,
                  y: y + (height / 2) - (fontSize / 2),
                  size: fontSize,
                  font: font,
                  color: rgb(0, 0, 0),
                  maxWidth: width - 4,
                });
              }
              break;

            default:
              console.warn(`⚠️ Unknown field type: ${field.type}`);
              break;
          }
        }
      }

      console.log('✅ Form fields added to PDF successfully');
      return pdfDoc;
    } catch (error) {
      console.error('❌ Add fields to PDF error:', error);
      throw new Error(`Failed to add fields to PDF: ${error.message}`);
    }
  }

  /**
   * Merge multiple documents and fill form fields
   * @param {object} documentData
   * @param {Array} signersData
   * @param {object} bucket - GCS bucket instance
   */
  async mergeDocumentsWithFields(documentData, signersData, bucket) {
    try {
      console.log('🔄 Starting document merge and field filling...');
      console.log(`📄 Processing document: ${documentData.title || documentData.originalName}`);
      console.log(`👥 Processing ${signersData.length} signer(s)`);

      const mergedPDF = await PDFDocument.create();
      const filePageStartIndices = [];
      let totalPages = 0;
      const files = documentData.files || [documentData];
      const filePagesList = [];

      // 1. Copy all pages from all files, and track mapping
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.fileName; // Use GCS path, not URL
        console.log(`📥 Processing file ${i + 1}/${files.length}: ${fileName}`);
        const [fileBuffer] = await bucket.file(fileName).download();
        let pdfBuffer;
        if (this.isPDF(fileBuffer)) {
          pdfBuffer = fileBuffer;
        } else {
          pdfBuffer = await this.imageToPDF(fileBuffer);
        }
        const sourcePDF = await PDFDocument.load(pdfBuffer);
        const pageIndices = sourcePDF.getPageIndices();
        const pages = await mergedPDF.copyPages(sourcePDF, pageIndices);
        filePageStartIndices.push(totalPages);
        filePagesList.push(pages.length);
        pages.forEach(page => mergedPDF.addPage(page));
        totalPages += pages.length;
      }

      // 2. Build a mapping: (fileIndex, pageNumber) => globalPageIndex
      const filePageToGlobalPage = {};
      for (let fileIdx = 0; fileIdx < filePagesList.length; fileIdx++) {
        const numPages = filePagesList[fileIdx];
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          filePageToGlobalPage[`${fileIdx}_${pageNum}`] = filePageStartIndices[fileIdx] + (pageNum - 1);
        }
      }

      // 3. Add fields from all signers to the correct global page
      for (const signerData of signersData) {
        if (signerData.signed && signerData.fieldValues) {
          console.log(`📝 Adding fields for signer: ${signerData.email}`);
          // Get all fields from all files
          let allFields = [];
          if (documentData.files && documentData.files.length > 0) {
            documentData.files.forEach((file, fileIndex) => {
              if (file.fields && file.fields.length > 0) {
                file.fields.forEach(field => {
                  allFields.push({ ...field, fileIndex: fileIndex, documentIndex: fileIndex });
                });
              }
            });
          } else if (documentData.fields && documentData.fields.length > 0) {
            allFields = documentData.fields.map(field => ({ ...field, fileIndex: 0, documentIndex: 0 }));
          }

          for (const field of allFields) {
            const signerFieldData = signerData.fieldValues?.[field.id];
            if (!signerFieldData || signerFieldData === '') continue;
            // Determine correct global page index
            const pageNum = field.pageNumber || 1;
            const fileIdx = field.fileIndex || field.documentIndex || 0;
            const globalPageIndex = filePageToGlobalPage[`${fileIdx}_${pageNum}`];
            if (globalPageIndex === undefined) {
              console.warn(`⚠️ No global page index for file ${fileIdx}, page ${pageNum}`);
              continue;
            }
            const page = mergedPDF.getPages()[globalPageIndex];
            const { width: pageWidth, height: pageHeight } = page.getSize();
            // Calculate field coordinates (same as before)
            let x, y, width, height;
            if (field.leftPercent !== undefined && field.topPercent !== undefined) {
              x = (field.leftPercent / 100) * pageWidth;
              y = pageHeight - ((field.topPercent / 100) * pageHeight) - ((field.heightPercent / 100) * pageHeight);
              width = (field.widthPercent / 100) * pageWidth;
              height = (field.heightPercent / 100) * pageHeight;
            } else if (field.x !== undefined && field.y !== undefined) {
              const originalWidth = field.originalWidth || pageWidth;
              const originalHeight = field.originalHeight || pageHeight;
              const scaleX = pageWidth / originalWidth;
              const scaleY = pageHeight / originalHeight;
              x = field.x * scaleX;
              y = pageHeight - (field.y * scaleY) - (field.height * scaleY);
              width = field.width * scaleX;
              height = field.height * scaleY;
            } else {
              console.warn(`⚠️ Field ${field.id} has no valid coordinates`);
              continue;
            }
            // Render field based on type (reuse logic from addFieldsToPDF)
            const font = await mergedPDF.embedFont(StandardFonts.Helvetica);
            switch (field.type) {
              case 'text':
              case 'name':
              case 'email':
              case 'phone':
              case 'date': {
                const fontSize = Math.max(8, Math.min(height * 0.6, 14));
                const textValue = signerFieldData.toString();
                page.drawText(textValue, {
                  x: x + 2,
                  y: y + (height / 2) - (fontSize / 2),
                  size: fontSize,
                  font: font,
                  color: rgb(0, 0, 0),
                  maxWidth: width - 4,
                });
                break;
              }
              case 'checkbox': {
                if (signerFieldData === true || signerFieldData === 'true') {
                  const checkSize = Math.min(width, height) * 0.8;
                  const checkX = x + (width - checkSize) / 2;
                  const checkY = y + (height - checkSize) / 2;
                  page.drawText('X', {
                    x: checkX,
                    y: checkY,
                    size: checkSize,
                    font: font,
                    color: rgb(0, 0, 0),
                  });
                }
                break;
              }
              case 'signature':
              case 'initial': {
                if (signerFieldData && signerFieldData.startsWith('data:image/')) {
                  try {
                    const base64Data = signerFieldData.split(',')[1];
                    const imageBuffer = Buffer.from(base64Data, 'base64');
                    let signatureImage;
                    if (signerFieldData.includes('data:image/png')) {
                      signatureImage = await mergedPDF.embedPng(imageBuffer);
                    } else {
                      signatureImage = await mergedPDF.embedJpg(imageBuffer);
                    }
                    page.drawImage(signatureImage, {
                      x: x,
                      y: y,
                      width: width,
                      height: height,
                    });
                  } catch (sigError) {
                    const fallbackText = field.type === 'initial' ? 'Initialed' : 'Signed';
                    page.drawText(fallbackText, {
                      x: x + 2,
                      y: y + (height / 2),
                      size: Math.min(height * 0.6, 12),
                      font: font,
                      color: rgb(0, 0, 0),
                    });
                  }
                } else if (signerFieldData) {
                  const fontSize = Math.max(8, Math.min(height * 0.6, 14));
                  page.drawText(signerFieldData.toString(), {
                    x: x + 2,
                    y: y + (height / 2) - (fontSize / 2),
                    size: fontSize,
                    font: font,
                    color: rgb(0, 0, 0),
                    maxWidth: width - 4,
                  });
                }
                break;
              }
              default:
                break;
            }
          }
        }
      }

      // Add metadata
      mergedPDF.setTitle(documentData.title || documentData.originalName || 'Signed Document');
      mergedPDF.setSubject('Digitally Signed Document');
      mergedPDF.setCreator('eSignTap');
      mergedPDF.setProducer('eSignTap PDF Service');
      mergedPDF.setCreationDate(new Date());
      mergedPDF.setModificationDate(new Date());

      const pdfBytes = await mergedPDF.save();
      console.log('✅ Document merge and field filling completed successfully');
      return Buffer.from(pdfBytes);
    } catch (error) {
      console.error('❌ Merge documents with fields error:', error);
      throw new Error(`Failed to merge documents with fields: ${error.message}`);
    }
  }

  /**
   * Generate completed document PDF with all signatures
   * @param {object} documentData
   * @param {Array} signersData
   * @param {object} bucket - GCS bucket instance
   */
  async generateCompletedDocument(documentData, signersData, bucket) {
    try {
      console.log('🎯 Generating completed document PDF...');
      const signedSigners = signersData.filter(signer => signer.signed);
      if (signedSigners.length === 0) {
        throw new Error('No signed data available for PDF generation');
      }
      console.log(`📝 Processing ${signedSigners.length} signed signer(s) out of ${signersData.length} total`);
      const completedPDFBuffer = await this.mergeDocumentsWithFields(documentData, signedSigners, bucket);
      const documentTitle = documentData.title || documentData.originalName || 'completed-document';
      return {
        buffer: completedPDFBuffer,
        filename: `${documentTitle}-signed.pdf`
      };
    } catch (error) {
      console.error('❌ Generate completed document error:', error);
      throw new Error(`Failed to generate completed document: ${error.message}`);
    }
  }
}

module.exports = new PDFService();