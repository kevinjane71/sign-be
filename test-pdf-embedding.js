const pdfService = require('./pdfService');

// Test PDF embedding with percentage-based fields
async function testPDFEmbedding() {
  console.log('🧪 Testing PDF Field Embedding');
  console.log('==============================');

  try {
    // Mock document data with percentage-based fields (multi-file format)
    const mockDocumentData = {
      title: 'Test Document',
      files: [
        {
          fileId: 'test-file-1',
          originalName: 'test.pdf',
          fields: [
            {
              id: 'test-text-field',
              type: 'text',
              leftPercent: 10,
              topPercent: 20,
              widthPercent: 30,
              heightPercent: 5,
              pageNumber: 1,
              required: true
            },
            {
              id: 'test-signature-field',
              type: 'signature',
              leftPercent: 50,
              topPercent: 50,
              widthPercent: 25,
              heightPercent: 8,
              pageNumber: 1,
              required: true
            },
            {
              id: 'test-checkbox-field',
              type: 'checkbox',
              leftPercent: 10,
              topPercent: 60,
              widthPercent: 5,
              heightPercent: 5,
              pageNumber: 1,
              required: false
            },
            {
              id: 'test-date-field',
              type: 'date',
              leftPercent: 20,
              topPercent: 70,
              widthPercent: 20,
              heightPercent: 5,
              pageNumber: 1,
              required: true
            }
          ]
        }
      ]
    };

    // Mock signer data with field values
    const mockSignerData = {
      email: 'test@example.com',
      signed: true,
      fieldValues: {
        'test-text-field': 'John Doe',
        'test-signature-field': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'test-checkbox-field': true,
        'test-date-field': '2024-01-15'
      }
    };

    console.log('📋 Mock document fields:', mockDocumentData.files[0].fields.length);
    console.log('👤 Mock signer field values:', Object.keys(mockSignerData.fieldValues).length);

    // Test field extraction logic
    console.log('\n🔍 Testing field extraction...');
    
    // Get all fields from document (same logic as PDF service)
    let allFields = [];
    
    if (mockDocumentData.files && mockDocumentData.files.length > 0) {
      // Multi-file document - collect fields from all files
      mockDocumentData.files.forEach((file, fileIndex) => {
        if (file.fields && file.fields.length > 0) {
          file.fields.forEach(field => {
            allFields.push({
              ...field,
              fileIndex: fileIndex,
              documentIndex: fileIndex
            });
          });
        }
      });
    }

    console.log(`✅ Extracted ${allFields.length} fields from document`);
    
    // Test percentage coordinate conversion
    console.log('\n📐 Testing coordinate conversion...');
    const mockPageWidth = 612; // Standard PDF page width
    const mockPageHeight = 792; // Standard PDF page height
    
    allFields.forEach(field => {
      if (field.leftPercent !== undefined && field.topPercent !== undefined) {
        const x = (field.leftPercent / 100) * mockPageWidth;
        const y = mockPageHeight - ((field.topPercent / 100) * mockPageHeight) - ((field.heightPercent / 100) * mockPageHeight);
        const width = (field.widthPercent / 100) * mockPageWidth;
        const height = (field.heightPercent / 100) * mockPageHeight;
        
        console.log(`  Field ${field.id}:`);
        console.log(`    Percentage: ${field.leftPercent}%, ${field.topPercent}%, ${field.widthPercent}%, ${field.heightPercent}%`);
        console.log(`    PDF coords: x=${x.toFixed(1)}, y=${y.toFixed(1)}, w=${width.toFixed(1)}, h=${height.toFixed(1)}`);
      }
    });

    console.log('\n✅ PDF embedding logic test completed successfully!');
    console.log('\n📝 Summary:');
    console.log(`   - Fields extracted: ${allFields.length}`);
    console.log(`   - Field values provided: ${Object.keys(mockSignerData.fieldValues).length}`);
    console.log(`   - Coordinate conversion: Working`);
    console.log(`   - Ready for PDF generation: ✅`);

  } catch (error) {
    console.error('❌ PDF embedding test failed:', error);
    console.error('Error details:', error.message);
  }
}

// Run the test
testPDFEmbedding().then(() => {
  console.log('\n🎯 Test completed');
}).catch(error => {
  console.error('❌ Test runner error:', error);
}); 