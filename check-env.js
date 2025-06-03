require('dotenv').config();

console.log('🔍 Checking environment variables...');
console.log('GODADY_EMAIL:', process.env.GODADY_EMAIL ? '✅ SET' : '❌ NOT SET');
console.log('GODADY_PA:', process.env.GODADY_PA ? '✅ SET' : '❌ NOT SET');

if (process.env.GODADY_EMAIL) {
  console.log('📧 Email value (first 3 chars):', process.env.GODADY_EMAIL.substring(0, 3) + '***');
}

if (process.env.GODADY_PA) {
  console.log('🔑 Password length:', process.env.GODADY_PA.length, 'characters');
}

// Test email with these credentials
if (process.env.GODADY_EMAIL && process.env.GODADY_PA) {
  console.log('\n🧪 Testing email with loaded credentials...');
  const sendTestEmail = require('./simple-email-test');
  
  sendTestEmail(process.env.GODADY_EMAIL, process.env.GODADY_PA, 'malik.vk07@gmail.com')
    .then(() => {
      console.log('✅ Email test completed!');
    })
    .catch((error) => {
      console.error('❌ Email test failed:', error.message);
    });
} else {
  console.log('\n❌ Cannot test email - credentials not found in environment variables');
  console.log('Please check your .env file in:', __dirname);
} 