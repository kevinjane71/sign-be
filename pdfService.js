const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const sharp = require('sharp');
const mammoth = require('mammoth');

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
   * Check if a file is a DOC/DOCX
   */
  isDOC(buffer) {
    // DOC files start with 0xD0CF11E0A1B11AE1 (OLE2 signature)
    const docSignature = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);
    // DOCX files are ZIP files with specific structure
    const zipSignature = Buffer.from([0x50, 0x4B, 0x03, 0x04]);
    
    return buffer.slice(0, 8).equals(docSignature) || 
           (buffer.slice(0, 4).equals(zipSignature) && this.isDocx(buffer));
  }

  /**
   * Check if ZIP file is a DOCX
   */
  isDocx(buffer) {
    // This is a simplified check - in practice, you'd need to examine the ZIP contents
    try {
      const bufferStr = buffer.toString('ascii', 0, 1000);
      return bufferStr.includes('word/') || bufferStr.includes('[Content_Types].xml');
    } catch {
      return false;
    }
  }

  /**
   * Detect image format from buffer with extension fallback
   */
  detectImageFormat(buffer, fileName = '') {
    if (!buffer || buffer.length < 16) {
      console.warn('⚠️ Buffer too small for format detection:', buffer?.length || 0);
      return this.detectFormatByExtension(fileName);
    }

    const header = buffer.slice(0, 16);
    
    // JPEG/JPG (same format, different extensions)
    if (header[0] === 0xFF && header[1] === 0xD8) {
      return 'jpeg'; // Handles both .jpg and .jpeg files
    }
    
    // PNG
    if (header.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
      return 'png';
    }
    
    // GIF87a or GIF89a
    if (header.slice(0, 6).toString() === 'GIF87a' || header.slice(0, 6).toString() === 'GIF89a') {
      return 'gif';
    }
    
    // WebP
    if (header.slice(0, 4).toString() === 'RIFF' && header.slice(8, 12).toString() === 'WEBP') {
      return 'webp';
    }
    
    // BMP
    if (header[0] === 0x42 && header[1] === 0x4D) {
      return 'bmp';
    }
    
    // TIFF (little-endian)
    if (header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2A && header[3] === 0x00) {
      return 'tiff';
    }
    
    // TIFF (big-endian)
    if (header[0] === 0x4D && header[1] === 0x4D && header[2] === 0x00 && header[3] === 0x2A) {
      return 'tiff';
    }
    
    // Fallback to extension-based detection
    console.log('⚠️ Binary detection failed, trying extension fallback for:', fileName);
    return this.detectFormatByExtension(fileName);
  }

  /**
   * Fallback method: detect format by file extension
   */
  detectFormatByExtension(fileName) {
    if (!fileName) return null;
    
    const ext = fileName.toLowerCase().split('.').pop();
    
    switch (ext) {
      case 'jpg':
      case 'jpeg':
        return 'jpeg';
      case 'png':
        return 'png';
      case 'gif':
        return 'gif';
      case 'webp':
        return 'webp';
      case 'bmp':
        return 'bmp';
      case 'tiff':
      case 'tif':
        return 'tiff';
      default:
        return null;
    }
  }

  /**
   * Convert DOC/DOCX to PDF using clever image approach
   * 1. Convert DOC to HTML (mammoth)
   * 2. Convert HTML to image (node-html-to-image or puppeteer-core)
   * 3. Convert image to PDF (existing logic)
   */
  async docToPDF(docBuffer) {
    console.log('📄 Converting DOC/DOCX to PDF via image conversion...');
    
    try {
      // Try HTML-to-image approach first (cleanest)
      return await this.docToPDFViaImage(docBuffer);
    } catch (imageError) {
      console.log('⚠️ Image conversion failed, trying text extraction...', imageError.message);
      
      // Fallback to text extraction
      try {
        return await this.docToPDFWithMammoth(docBuffer);
      } catch (mammothError) {
        console.log('⚠️ Mammoth conversion failed, using fallback...');
        return await this.docToPDFTextFallback(docBuffer);
      }
    }
  }

  /**
   * Convert DOC to PDF via image conversion (clever approach)
   */
  async docToPDFViaImage(docBuffer) {
    console.log('🖼️ Converting DOC → HTML → Image → PDF...');
    
    // Step 1: Convert DOC to HTML
    const result = await mammoth.convertToHtml({ buffer: docBuffer });
    const html = result.value;
    
    if (result.messages.length > 0) {
      console.warn('⚠️ DOC extraction warnings:', result.messages);
    }
    
    // Step 2: Create styled HTML for better rendering
    const styledHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { 
            font-family: Arial, sans-serif; 
            margin: 40px; 
            line-height: 1.6;
            color: #333;
            background: white;
            width: 794px; /* A4 width at 96 DPI */
            min-height: 1123px; /* A4 height at 96 DPI */
          }
          p { margin: 0 0 12px 0; }
          h1, h2, h3, h4, h5, h6 { margin: 20px 0 10px 0; }
          table { border-collapse: collapse; width: 100%; }
          td, th { border: 1px solid #ddd; padding: 8px; }
        </style>
      </head>
      <body>
        ${html}
      </body>
      </html>
    `;
    
    // Step 3: Convert HTML to image
    const imageBuffer = await this.htmlToImage(styledHtml);
    
    // Step 4: Convert image to PDF using existing logic
    const pdfBuffer = await this.imageToPDF(imageBuffer, 'converted-doc.png');
    
    console.log('✅ DOC converted via HTML→Image→PDF successfully');
    return pdfBuffer;
  }

  /**
   * Convert HTML to image using pure library approach
   */
  async htmlToImage(html) {
    // Try node-html-to-image (works without full browser)
    try {
      const nodeHtmlToImage = require('node-html-to-image');
      
      const imageBuffer = await nodeHtmlToImage({
        html: html,
        type: 'png',
        quality: 100,
        encoding: 'binary',
        content: { 
          width: 794,  // A4 width at 96 DPI
          height: 1123 // A4 height at 96 DPI
        }
      });
      
      console.log('✅ HTML converted to image using node-html-to-image');
      return imageBuffer;
    } catch (nodeHtmlError) {
      console.log('⚠️ node-html-to-image not available:', nodeHtmlError.message);
    }

    // Try html2canvas approach with canvas (pure Node.js)
    try {
      return await this.htmlToImageWithCanvas(html);
    } catch (canvasError) {
      console.log('⚠️ Canvas approach not available:', canvasError.message);
    }

    // Final fallback - no HTML-to-image conversion available
    throw new Error('No HTML-to-image library available. Install: npm install node-html-to-image');
  }

  /**
   * Alternative HTML to image using Canvas (if available)
   */
  async htmlToImageWithCanvas(html) {
    try {
      const { createCanvas } = require('canvas');
      
      // Create a simple canvas representation
      const canvas = createCanvas(794, 1123);
      const ctx = canvas.getContext('2d');
      
      // Fill white background
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 794, 1123);
      
      // Simple text rendering (basic fallback)
      ctx.fillStyle = 'black';
      ctx.font = '12px Arial';
      
      // Extract text from HTML (very basic)
      const textOnly = html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
      const lines = this.wrapText(textOnly, 70); // ~70 chars per line
      
      let y = 50;
      for (let i = 0; i < Math.min(lines.length, 80); i++) { // Max 80 lines
        ctx.fillText(lines[i], 50, y);
        y += 14;
        if (y > 1100) break;
      }
      
      const imageBuffer = canvas.toBuffer('image/png');
      console.log('✅ HTML converted to image using Canvas');
      return imageBuffer;
    } catch (canvasError) {
      throw new Error('Canvas library not available. Install: npm install canvas');
    }
  }

  /**
   * Helper function to wrap text
   */
  wrapText(text, maxCharsPerLine) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';
    
    for (const word of words) {
      if (currentLine.length + word.length + 1 <= maxCharsPerLine) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
    
    return lines;
  }



  /**
   * Convert DOC/DOCX using Mammoth + basic PDF creation
   */
  async docToPDFWithMammoth(docBuffer) {
    const result = await mammoth.extractRawText({ buffer: docBuffer });
    const text = result.value;
    
    if (result.messages.length > 0) {
      console.warn('⚠️ DOC extraction warnings:', result.messages);
    }
    
    // Create PDF from extracted text using pdf-lib
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page = pdfDoc.addPage([595, 842]); // A4 size
    
    const lines = text.split('\n');
    let yPosition = 800;
    const margin = 50;
    const lineHeight = 14;
    
    for (const line of lines) {
      if (yPosition < margin) {
        // Add new page if content overflows
        const newPage = pdfDoc.addPage([595, 842]);
        yPosition = 800;
        newPage.drawText(line, {
          x: margin,
          y: yPosition,
          size: 12,
          font: font,
          color: rgb(0, 0, 0),
          maxWidth: 495
        });
      } else {
        page.drawText(line, {
          x: margin,
          y: yPosition,
          size: 12,
          font: font,
          color: rgb(0, 0, 0),
          maxWidth: 495
        });
      }
      yPosition -= lineHeight;
    }
    
    const pdfBytes = await pdfDoc.save();
    console.log('✅ DOC/DOCX converted using Mammoth + pdf-lib');
    return Buffer.from(pdfBytes);
  }

  /**
   * Final fallback method - create informative PDF with basic text
   */
  async docToPDFTextFallback(docBuffer) {
    console.warn('⚠️ Using fallback DOC conversion method');
    
    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page = pdfDoc.addPage([595, 842]);
    
    const errorText = [
      'Document Conversion Notice',
      '',
      'This DOC/DOCX file could not be converted to PDF.',
      'HTML-to-image libraries are not available.',
      '',
      'Recommendations:',
      '• Convert the file to PDF before uploading',
      '• Install node-html-to-image or puppeteer-core:',
      '  npm install node-html-to-image',
      '• Or use text-only conversion available below',
      '',
      'Processing file as text extraction...'
    ];
    
    let yPosition = 750;
    for (const line of errorText) {
      page.drawText(line, {
        x: 50,
        y: yPosition,
        size: line === errorText[0] ? 16 : 12,
        font: font,
        color: rgb(0, 0, 0)
      });
      yPosition -= line === errorText[0] ? 24 : 16;
    }
    
    // Try to at least extract some text
    try {
      const result = await mammoth.extractRawText({ buffer: docBuffer });
      const text = result.value;
      
      if (text.trim()) {
        yPosition -= 30;
        page.drawText('Extracted text:', {
          x: 50,
          y: yPosition,
          size: 14,
          font: font,
          color: rgb(0, 0, 0)
        });
        
        yPosition -= 20;
        const textLines = text.split('\n').slice(0, 15); // First 15 lines only
        
        for (const line of textLines) {
          if (yPosition < 50) break;
          
          page.drawText(line.substring(0, 80), { // Truncate long lines
            x: 50,
            y: yPosition,
            size: 10,
            font: font,
            color: rgb(0.2, 0.2, 0.2),
            maxWidth: 500
          });
          yPosition -= 12;
        }
      }
    } catch (textError) {
      console.warn('Could not extract text from DOC:', textError.message);
    }
    
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  /**
   * Convert image to PDF (supports multiple formats)
   */
  async imageToPDF(imageBuffer, fileName = '') {
    try {
      console.log('🖼️ Converting image to PDF...');
      
      // Detect image format with filename fallback
      const format = this.detectImageFormat(imageBuffer, fileName);
      console.log(`🔍 Detected image format: ${format}`);
      
      if (!format) {
        throw new Error('Unsupported image format. Supported formats: JPEG, PNG, GIF, WebP, BMP, TIFF');
      }
      
      const pdfDoc = await PDFDocument.create();
      let image;
      
      // For formats not directly supported by pdf-lib, convert to PNG first
      if (format === 'gif' || format === 'webp' || format === 'bmp' || format === 'tiff') {
        console.log(`🔄 Converting ${format.toUpperCase()} to PNG for PDF embedding...`);
        
        try {
          // Use sharp to convert to PNG
          const pngBuffer = await sharp(imageBuffer)
            .png()
            .toBuffer();
          
          image = await pdfDoc.embedPng(pngBuffer);
        } catch (sharpError) {
          console.error('❌ Sharp conversion error:', sharpError);
          throw new Error(`Failed to convert ${format.toUpperCase()} image: ${sharpError.message}`);
        }
      } else if (format === 'jpeg') {
        // Direct JPEG embedding
        image = await pdfDoc.embedJpg(imageBuffer);
      } else if (format === 'png') {
        // Direct PNG embedding
        image = await pdfDoc.embedPng(imageBuffer);
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
      console.log(`✅ ${format.toUpperCase()} image converted to PDF successfully`);
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

          // Calculate field coordinates with improved accuracy
          let x, y, width, height;
          
          console.log(`🔧 Processing field: ${field.id}, type: ${field.type}`);
          console.log(`📄 Page dimensions: ${pageWidth}x${pageHeight}`);
          
          if (field.leftPercent !== undefined && field.topPercent !== undefined) {
            // New percentage-based coordinates (preferred method)
            console.log(`📊 Using percentage coordinates: left=${field.leftPercent}%, top=${field.topPercent}%, width=${field.widthPercent}%, height=${field.heightPercent}%`);
            
            width = (field.widthPercent / 100) * pageWidth;
            height = (field.heightPercent / 100) * pageHeight;
            x = (field.leftPercent / 100) * pageWidth;
            
            // Fix Y coordinate calculation - PDF coordinates start from bottom-left
            // UI coordinates start from top-left, so we need to flip the Y axis
            const topY = (field.topPercent / 100) * pageHeight;
            y = pageHeight - topY - height; // Correct Y position
            
            console.log(`✅ Percentage calculation: x=${x.toFixed(2)}, y=${y.toFixed(2)}, w=${width.toFixed(2)}, h=${height.toFixed(2)}`);
            
          } else if (field.x !== undefined && field.y !== undefined) {
            // Legacy pixel-based coordinates
            console.log(`📐 Using pixel coordinates: x=${field.x}, y=${field.y}, width=${field.width}, height=${field.height}`);
            console.log(`📐 Original dimensions: ${field.originalWidth || 'unknown'}x${field.originalHeight || 'unknown'}`);
            
            const originalWidth = field.originalWidth || pageWidth;
            const originalHeight = field.originalHeight || pageHeight;
            
            const scaleX = pageWidth / originalWidth;
            const scaleY = pageHeight / originalHeight;
            
            console.log(`📏 Scale factors: scaleX=${scaleX.toFixed(3)}, scaleY=${scaleY.toFixed(3)}`);
            
            width = field.width * scaleX;
            height = field.height * scaleY;
            x = field.x * scaleX;
            
            // Fix Y coordinate calculation for pixel-based coordinates
            // field.y is from top-left in UI, convert to bottom-left for PDF
            y = pageHeight - (field.y * scaleY) - (field.height * scaleY);
            
            console.log(`✅ Pixel calculation: x=${x.toFixed(2)}, y=${y.toFixed(2)}, w=${width.toFixed(2)}, h=${height.toFixed(2)}`);
            
          } else {
            console.warn(`⚠️ Field ${field.id} has no valid coordinates`);
            continue;
          }

          // Validate coordinates are within page bounds
          if (x < 0 || y < 0 || x + width > pageWidth || y + height > pageHeight) {
            console.warn(`⚠️ Field ${field.id} coordinates out of bounds:`, {
              x: x.toFixed(2), 
              y: y.toFixed(2), 
              width: width.toFixed(2), 
              height: height.toFixed(2),
              pageWidth, 
              pageHeight
            });
            
            // Clamp coordinates to page bounds
            x = Math.max(0, Math.min(x, pageWidth - width));
            y = Math.max(0, Math.min(y, pageHeight - height));
            width = Math.min(width, pageWidth - x);
            height = Math.min(height, pageHeight - y);
            
            console.log(`🔧 Clamped coordinates: x=${x.toFixed(2)}, y=${y.toFixed(2)}, w=${width.toFixed(2)}, h=${height.toFixed(2)}`);
          }

          console.log(`📍 Final field coordinates: x=${x.toFixed(2)}, y=${y.toFixed(2)}, w=${width.toFixed(2)}, h=${height.toFixed(2)}`);

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
   * Supports ANY combination of file types:
   * - PDF files (used directly)
   * - DOC/DOCX files (converted via DOC→HTML→Image→PDF approach)
   * - Image files: JPEG/JPG, PNG, GIF, WebP, BMP, TIFF (converted via sharp + pdf-lib)
   * 
   * Handles all scenarios:
   * - Single file of any type
   * - Multiple files of same type  
   * - Mixed combinations (PDF + DOC + Images)
   * 
   * DOC conversion process:
   * 1. DOC → HTML (mammoth)
   * 2. HTML → Image (node-html-to-image or canvas fallback) 
   * 3. Image → PDF (existing sharp + pdf-lib logic)
   * 
   * All files are converted to PDF and merged into a single signed document
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
      let processedFiles = [];
      let hasValidFiles = false;

      // 1. Analyze and categorize all files
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const fileName = file.fileName;
        console.log(`🔍 Analyzing file ${i + 1}/${files.length}: ${fileName}`);
        
        try {
          const [fileBuffer] = await bucket.file(fileName).download();
          let fileType = 'unknown';
          
          // Check file type
          if (this.isPDF(fileBuffer)) {
            fileType = 'pdf';
            console.log(`📄 Detected as PDF: ${fileName}`);
          } else if (this.isDOC(fileBuffer)) {
            fileType = 'doc';
            console.log(`📝 Detected as DOC: ${fileName}`);
          } else {
            const imageFormat = this.detectImageFormat(fileBuffer, fileName);
            console.log(`🔍 Image format detection result for ${fileName}:`, imageFormat);
            if (imageFormat) {
              fileType = 'image';
              console.log(`🖼️ Detected as image (${imageFormat}): ${fileName}`);
            } else {
              console.log(`❌ Could not detect format for ${fileName}, buffer length:`, fileBuffer.length);
              console.log(`📋 First 16 bytes:`, Array.from(fileBuffer.slice(0, 16)).map(b => `0x${b.toString(16).padStart(2, '0')}`).join(' '));
            }
          }
          
          if (fileType !== 'unknown') {
            hasValidFiles = true;
            processedFiles.push({ buffer: fileBuffer, file, type: fileType });
            console.log(`✅ File ${fileName} detected as: ${fileType.toUpperCase()}`);
          } else {
            console.warn(`⚠️ File ${fileName} is not a supported format, skipping.`);
          }
        } catch (error) {
          console.error(`❌ Error processing file ${fileName}:`, error.message);
        }
      }

      if (!hasValidFiles) {
        throw new Error('No supported files found. Supported formats: PDF, DOC/DOCX, JPEG, PNG, GIF, WebP, BMP, TIFF');
      }

      // 2. Convert ALL files to PDF and merge (handles any combination)
      console.log(`📝 Processing ${processedFiles.length} file(s) of various types...`);
      
      for (const { buffer, file, type } of processedFiles) {
        const fileName = file.fileName;
        console.log(`📥 Processing file: ${fileName} (${type.toUpperCase()})`);
        
        try {
          let pdfBuffer;
          
          // Convert each file to PDF based on its type
          if (type === 'pdf') {
            console.log(`📄 Using existing PDF: ${fileName}`);
            pdfBuffer = buffer;
          } else if (type === 'image') {
            console.log(`🖼️ Converting image to PDF: ${fileName}`);
            pdfBuffer = await this.imageToPDF(buffer, fileName);
          } else if (type === 'doc') {
            console.log(`📄 Converting DOC/DOCX to PDF: ${fileName}`);
            pdfBuffer = await this.docToPDF(buffer);
          }
          
          // Add the converted PDF to the merged document
          if (pdfBuffer) {
            const sourcePDF = await PDFDocument.load(pdfBuffer);
            const pageIndices = sourcePDF.getPageIndices();
            const pages = await mergedPDF.copyPages(sourcePDF, pageIndices);
            
            filePageStartIndices.push(totalPages);
            filePagesList.push(pages.length);
            pages.forEach(page => mergedPDF.addPage(page));
            totalPages += pages.length;
            
            console.log(`✅ ${fileName} processed and added (${pages.length} pages)`);
          }
        } catch (processingError) {
          console.error(`❌ Error processing ${fileName}:`, processingError.message);
          // Continue with other files even if one fails
        }
      }

      // Check if we have any valid pages after processing
      if (totalPages === 0) {
        throw new Error('No valid pages found after processing all files. Please check file formats and try again.');
      }

      console.log(`📊 Successfully processed ${processedFiles.length} file(s) with ${totalPages} total page(s)`);

      // 3. Build a mapping: (fileIndex, pageNumber) => globalPageIndex
      const filePageToGlobalPage = {};
      for (let fileIdx = 0; fileIdx < filePagesList.length; fileIdx++) {
        const numPages = filePagesList[fileIdx];
        for (let pageNum = 1; pageNum <= numPages; pageNum++) {
          filePageToGlobalPage[`${fileIdx}_${pageNum}`] = filePageStartIndices[fileIdx] + (pageNum - 1);
        }
      }

      // 4. Add fields from all signers to the correct global page
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
            
            // Calculate field coordinates with improved accuracy (consistent with addFieldsToPDF)
            let x, y, width, height;
            
            console.log(`🔧 Merge: Processing field ${field.id}, type: ${field.type}`);
            console.log(`📄 Merge: Page dimensions: ${pageWidth}x${pageHeight}`);
            
            if (field.leftPercent !== undefined && field.topPercent !== undefined) {
              // New percentage-based coordinates (preferred method)
              console.log(`📊 Merge: Using percentage coordinates: left=${field.leftPercent}%, top=${field.topPercent}%, width=${field.widthPercent}%, height=${field.heightPercent}%`);
              
              width = (field.widthPercent / 100) * pageWidth;
              height = (field.heightPercent / 100) * pageHeight;
              x = (field.leftPercent / 100) * pageWidth;
              
              // Fix Y coordinate calculation - PDF coordinates start from bottom-left
              const topY = (field.topPercent / 100) * pageHeight;
              y = pageHeight - topY - height; // Correct Y position
              
              console.log(`✅ Merge: Percentage calculation: x=${x.toFixed(2)}, y=${y.toFixed(2)}, w=${width.toFixed(2)}, h=${height.toFixed(2)}`);
              
            } else if (field.x !== undefined && field.y !== undefined) {
              // Legacy pixel-based coordinates
              console.log(`📐 Merge: Using pixel coordinates: x=${field.x}, y=${field.y}, width=${field.width}, height=${field.height}`);
              
              const originalWidth = field.originalWidth || pageWidth;
              const originalHeight = field.originalHeight || pageHeight;
              const scaleX = pageWidth / originalWidth;
              const scaleY = pageHeight / originalHeight;
              
              console.log(`📏 Merge: Scale factors: scaleX=${scaleX.toFixed(3)}, scaleY=${scaleY.toFixed(3)}`);
              
              width = field.width * scaleX;
              height = field.height * scaleY;
              x = field.x * scaleX;
              
              // Fix Y coordinate calculation for pixel-based coordinates
              y = pageHeight - (field.y * scaleY) - (field.height * scaleY);
              
              console.log(`✅ Merge: Pixel calculation: x=${x.toFixed(2)}, y=${y.toFixed(2)}, w=${width.toFixed(2)}, h=${height.toFixed(2)}`);
              
            } else {
              console.warn(`⚠️ Field ${field.id} has no valid coordinates`);
              continue;
            }
            
            // Validate coordinates are within page bounds
            if (x < 0 || y < 0 || x + width > pageWidth || y + height > pageHeight) {
              console.warn(`⚠️ Merge: Field ${field.id} coordinates out of bounds:`, {
                x: x.toFixed(2), 
                y: y.toFixed(2), 
                width: width.toFixed(2), 
                height: height.toFixed(2),
                pageWidth, 
                pageHeight
              });
              
              // Clamp coordinates to page bounds
              x = Math.max(0, Math.min(x, pageWidth - width));
              y = Math.max(0, Math.min(y, pageHeight - height));
              width = Math.min(width, pageWidth - x);
              height = Math.min(height, pageHeight - y);
              
              console.log(`🔧 Merge: Clamped coordinates: x=${x.toFixed(2)}, y=${y.toFixed(2)}, w=${width.toFixed(2)}, h=${height.toFixed(2)}`);
            }
            
            console.log(`📍 Merge: Final field coordinates: x=${x.toFixed(2)}, y=${y.toFixed(2)}, w=${width.toFixed(2)}, h=${height.toFixed(2)}`);
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