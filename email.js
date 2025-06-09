const nodemailer = require('nodemailer');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: 'smtpout.secureserver.net',
      port: 465,
      secure: true,
      auth: {
        user: process.env.GODADY_EMAIL,
        pass: process.env.GODADY_PA
      },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 15000,
      socketTimeout: 15000
    });

    this.getMeetingIcon = (meetingType) => {
      switch(meetingType?.toLowerCase()) {
        case 'google meet':
          return 'Google Meet';
        case 'zoom':
          return 'Zoom Call';
        case 'teams':
          return 'MS Teams';
        default:
          return '🔗';
      }
    };

    this.templates = {
      // Document Signing Templates
      documentShare: {
        getSubject: (documentTitle) => `🔔 Action Required: Sign "${documentTitle}" - eSignTap`,
        
        text: (documentData) => `
Dear ${documentData.signerName},

You have received a document that requires your signature.

Document: ${documentData.documentTitle}
From: ${documentData.senderName} (${documentData.senderEmail})
${documentData.message ? `Message: "${documentData.message}"` : ''}

To review and sign the document, please click the link below:
${documentData.signingUrl}

This signature request will expire in 30 days.

Best regards,
eSignTap Team`,

        html: (documentData) => `
<!DOCTYPE html>
<html>
<body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f7fa;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 40px 20px; text-align: center;">
      <div style="font-size: 50px; margin-bottom: 15px;">✍️📋</div>
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: 0.5px;">Action Required: Sign Document</h1>
      <p style="color: #E0E7FF; margin-top: 10px; font-size: 16px;">
        Your signature is needed to complete this document
      </p>
    </div>

    <!-- Main Content -->
    <div style="padding: 32px 24px; background-color: #ffffff;">
      <p style="font-size: 16px; color: #4B5563; margin-top: 0;">Dear ${documentData.signerName},</p>
      
      <div style="background-color: #F3F4F6; border-left: 4px solid #4F46E5; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="font-size: 16px; color: #4B5563; margin: 0;">
          <strong style="color: #4F46E5;">${documentData.senderName}</strong> has sent you a document that requires your signature.
        </p>
      </div>

      ${documentData.message ? `
      <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="margin: 0 0 12px 0; color: #111827; font-size: 16px;">Message from sender:</h3>
        <p style="margin: 0; color: #4B5563; font-style: italic;">"${documentData.message}"</p>
      </div>
      ` : ''}

      <!-- Document Info -->
      <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <div style="display: flex; align-items: center; margin-bottom: 16px;">
          <div style="width: 40px; height: 40px; margin-right: 12px; background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 20px; color: white;">📄</span>
          </div>
          <div>
            <p style="margin: 0; font-size: 14px; color: #6B7280;">Document</p>
            <p style="margin: 0; font-size: 16px; font-weight: 600; color: #111827;">${documentData.documentTitle}</p>
          </div>
        </div>
        
        <div style="display: flex; align-items: center; margin-bottom: 16px;">
          <div style="width: 40px; height: 40px; margin-right: 12px; background: #10B981; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 20px; color: white;">👤</span>
          </div>
          <div>
            <p style="margin: 0; font-size: 14px; color: #6B7280;">From</p>
            <p style="margin: 0; font-size: 16px; font-weight: 500; color: #111827;">${documentData.senderName}</p>
            <p style="margin: 0; font-size: 14px; color: #6B7280;">${documentData.senderEmail}</p>
          </div>
        </div>
        
        <div style="display: flex; align-items: center;">
          <div style="width: 40px; height: 40px; margin-right: 12px; background: #F59E0B; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 20px; color: white;">⏰</span>
          </div>
          <div>
            <p style="margin: 0; font-size: 14px; color: #6B7280;">Sent</p>
            <p style="margin: 0; font-size: 16px; font-weight: 500; color: #111827;">${documentData.sentDate}</p>
          </div>
        </div>
      </div>

      <!-- Security Notice -->
      <div style="background-color: #FEF3C7; border: 1px solid #F59E0B; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <div style="display: flex; align-items: center;">
          <span style="font-size: 20px; margin-right: 8px;">🔒</span>
          <p style="margin: 0; font-size: 14px; color: #92400E; font-weight: 500;">
            This document is secured and can only be accessed by authorized signers.
          </p>
        </div>
      </div>

      <!-- Action Button -->
      <div style="text-align: center; margin: 32px 0 24px 0;">
        <a href="${documentData.signingUrl}" 
           style="display: inline-block; background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); color: white; padding: 18px 40px; text-decoration: none; border-radius: 10px; font-weight: bold; font-size: 18px; text-transform: uppercase; letter-spacing: 1px; box-shadow: 0 6px 20px rgba(79, 70, 229, 0.4); transition: all 0.3s ease; margin: 10px;">
          ✍️ START SIGNING NOW
        </a>
        <p style="margin: 16px 0 0 0; font-size: 14px; color: #6B7280;">
          Click the button above to review and sign the document
        </p>
      </div>
      
      <p style="font-size: 13px; color: #6B7280; text-align: center; font-style: italic; margin-bottom: 0;">
        This signature request will expire in 30 days. If you have any questions, please contact the sender directly.
      </p>
    </div>

    <!-- Footer -->
    <div style="background-color: #F3F4F6; padding: 24px; text-align: center; border-top: 1px solid #E5E7EB;">
      <p style="color: #6B7280; margin: 0; font-size: 14px;">© ${new Date().getFullYear()} eSignTap. Professional Document Signing.</p>
      <div style="margin-top: 16px;">
        <a href="https://esigntap.com/help" style="color: #4F46E5; text-decoration: none; margin: 0 8px; font-size: 14px;">Help Center</a>
        <a href="https://esigntap.com/privacy" style="color: #4F46E5; text-decoration: none; margin: 0 8px; font-size: 14px;">Privacy Policy</a>
        <a href="https://esigntap.com/security" style="color: #4F46E5; text-decoration: none; margin: 0 8px; font-size: 14px;">Security</a>
      </div>
    </div>
  </div>
</body>
</html>`
      },

      documentCompleted: {
        getSubject: (documentTitle) => `✅ Document Signed: ${documentTitle}`,
        
        text: (documentData) => `
Dear ${documentData.recipientName},

Great news! The document "${documentData.documentTitle}" has been successfully signed by all parties.

Document Details:
- Title: ${documentData.documentTitle}
- Completed: ${documentData.completedDate}
- Signers: ${documentData.signers.map(s => `${s.name} (${s.email})`).join(', ')}

You can download the completed document using the link below:
${documentData.downloadUrl}

Thank you for using eSignTap.

Best regards,
eSignTap Team`,

        html: (documentData) => `
<!DOCTYPE html>
<html>
<body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f7fa;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #10B981 0%, #059669 100%); padding: 40px 20px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: 0.5px;">Document Completed!</h1>
      <p style="color: #D1FAE5; margin-top: 10px; font-size: 16px;">
        All signatures have been collected successfully
      </p>
    </div>

    <!-- Main Content -->
    <div style="padding: 32px 24px; background-color: #ffffff;">
      <p style="font-size: 16px; color: #4B5563; margin-top: 0;">Dear ${documentData.recipientName},</p>
      
      <div style="background-color: #ECFDF5; border-left: 4px solid #10B981; padding: 16px; margin: 24px 0; border-radius: 4px;">
        <p style="font-size: 16px; color: #065F46; margin: 0;">
          <strong>Great news!</strong> The document "<strong>${documentData.documentTitle}</strong>" has been successfully signed by all parties.
        </p>
      </div>

      <!-- Document Info -->
      <div style="background-color: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <h3 style="margin: 0 0 16px 0; color: #111827; font-size: 18px;">📋 Document Summary</h3>
        
        <div style="display: flex; align-items: center; margin-bottom: 16px;">
          <div style="width: 40px; height: 40px; margin-right: 12px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); border-radius: 8px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 20px; color: white;">📄</span>
          </div>
          <div>
            <p style="margin: 0; font-size: 14px; color: #6B7280;">Document</p>
            <p style="margin: 0; font-size: 16px; font-weight: 600; color: #111827;">${documentData.documentTitle}</p>
          </div>
        </div>
        
        <div style="display: flex; align-items: center; margin-bottom: 16px;">
          <div style="width: 40px; height: 40px; margin-right: 12px; background: #3B82F6; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 20px; color: white;">✅</span>
          </div>
          <div>
            <p style="margin: 0; font-size: 14px; color: #6B7280;">Completed</p>
            <p style="margin: 0; font-size: 16px; font-weight: 500; color: #111827;">${documentData.completedDate}</p>
          </div>
        </div>
        
        <div style="display: flex; align-items: flex-start;">
          <div style="width: 40px; height: 40px; margin-right: 12px; background: #8B5CF6; border-radius: 8px; display: flex; align-items: center; justify-content: center;">
            <span style="font-size: 20px; color: white;">👥</span>
          </div>
          <div>
            <p style="margin: 0 0 8px 0; font-size: 14px; color: #6B7280;">Signers</p>
            ${documentData.signers.map(signer => `
              <div style="margin-bottom: 4px;">
                <span style="font-size: 14px; color: #111827; font-weight: 500;">${signer.name}</span>
                <span style="font-size: 13px; color: #6B7280; margin-left: 8px;">(${signer.email})</span>
                <span style="font-size: 12px; color: #10B981; margin-left: 8px;">✓ Signed</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <!-- Action Button -->
      <div style="text-align: center; margin: 32px 0 24px 0;">
        <a href="${documentData.downloadUrl}" 
           style="display: inline-block; background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3); transition: all 0.3s ease;">
          📥 Download Signed Document
        </a>
      </div>
      
      <p style="font-size: 13px; color: #6B7280; text-align: center; font-style: italic; margin-bottom: 0;">
        Keep this document in a secure location. You can download it anytime from your eSingTap dashboard.
      </p>
    </div>

    <!-- Footer -->
    <div style="background-color: #F3F4F6; padding: 24px; text-align: center; border-top: 1px solid #E5E7EB;">
      <p style="color: #6B7280; margin: 0; font-size: 14px;">© ${new Date().getFullYear()} eSingTap. Professional Document Signing.</p>
      <div style="margin-top: 16px;">
        <a href="https://esigntap.com/dashboard" style="color: #10B981; text-decoration: none; margin: 0 8px; font-size: 14px;">Dashboard</a>
        <a href="https://esigntap.com/help" style="color: #10B981; text-decoration: none; margin: 0 8px; font-size: 14px;">Help Center</a>
        <a href="https://esigntap.com/support" style="color: #10B981; text-decoration: none; margin: 0 8px; font-size: 14px;">Support</a>
      </div>
    </div>
  </div>
</body>
</html>`
      },

      meetingInvite: {
        getSubject: (isReschedule, eventTitle) => 
          isReschedule 
            ? `Meeting Rescheduled: ${eventTitle || 'Updated Meeting'}`
            : `Meeting Confirmation: ${eventTitle || 'New Meeting'}`,

        text: (meetingData) => `
Dear ${meetingData.name},

${meetingData.isReschedule 
  ? 'Your meeting has been rescheduled to the following time:'
  : 'Your meeting has been scheduled successfully.'}

Meeting Details:
- Date: ${meetingData?.meetingDateTime.format('LL')}
- Time: ${meetingData?.meetingDateTime.format('LT')} ${meetingData?.timeZone}
- Time Zone: ${meetingData?.timeZone}
- Meeting Type: ${meetingData?.meetingType || 'Online Meeting'}
- Meeting Link: ${meetingData?.meetingLink || '--'}
- Notes: ${meetingData?.notes || 'No additional notes'}

Manage your meeting:
Reschedule: https://www.eSignTap.com/${meetingData?.eventSlug}?rescheduleId=${meetingData?.eventId}
Cancel: https://www.eSignTap.com/${meetingData?.eventSlug}?rescheduleId=${meetingData?.eventId}

${meetingData.isReschedule 
  ? 'The previous meeting has been canceled. You will receive a new calendar invitation shortly.'
  : 'The meeting has been added to your calendar. You will receive a calendar invitation separately.'}

Best regards,
The E-SignTap Team`,

        html: (meetingData) => `
<!DOCTYPE html>
<html>
<body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f7fa;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 40px 20px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px;">
        ${meetingData.isReschedule ? 'Meeting Rescheduled' : 'Meeting Confirmation'}
      </h1>
      <p style="color: #E0E7FF; margin-top: 10px; font-size: 16px;">
        ${meetingData.isReschedule 
          ? 'Your meeting has been rescheduled to a new time'
          : 'Your meeting is scheduled!'}
      </p>
    </div>

    <!-- Main Content -->
    <div style="padding: 32px 24px;">
      <p style="font-size: 16px; color: #4B5563;">Dear ${meetingData?.name},</p>
      
      <p style="font-size: 16px; color: #4B5563;">
        ${meetingData.isReschedule 
          ? 'Your meeting has been rescheduled to the following time:'
          : 'Your meeting has been scheduled successfully.'}
      </p>

      <div style="background-color: #F3F4F6; padding: 24px; border-radius: 8px; margin: 24px 0;">
        <h3 style="color: #1F2937; margin: 0 0 16px 0;">
          ${meetingData.isReschedule ? 'Updated Meeting Details' : 'Meeting Details'} 
          ${meetingData.getMeetingIcon?.(meetingData?.meetingType)}
        </h3>
        
        <div style="margin-bottom: 12px;">
          <p style="color: #4B5563; margin: 0 0 4px 0;"><strong>Date:</strong></p>
          <p style="color: #6B7280; margin: 0;">${meetingData?.meetingDateTime.format('LL')}</p>
        </div>
        
        <div style="margin-bottom: 12px;">
          <p style="color: #4B5563; margin: 0 0 4px 0;"><strong>Time:</strong></p>
          <p style="color: #6B7280; margin: 0;">${meetingData?.meetingDateTime.format('LT')} ${meetingData?.timeZone}</p>
        </div>
        
        <div style="margin-bottom: 12px;">
          <p style="color: #4B5563; margin: 0 0 4px 0;"><strong>Time Zone:</strong></p>
          <p style="color: #6B7280; margin: 0;">${meetingData?.timeZone}</p>
        </div>
        
        <div style="margin-bottom: 12px;">
          <p style="color: #4B5563; margin: 0 0 4px 0;"><strong>Meeting Type:</strong></p>
          <p style="color: #6B7280; margin: 0;">${meetingData?.meetingType || 'Online Meeting'}</p>
        </div>
        
        <div style="margin-bottom: 12px;">
          <p style="color: #4B5563; margin: 0 0 4px 0;"><strong>Meeting Link:</strong></p>
          <p style="color: #6B7280; margin: 0;">
            <a href="${meetingData?.meetingLink}" style="color: #4F46E5; text-decoration: none;">${meetingData?.meetingLink || '--'}</a>
          </p>
        </div>
        
        ${meetingData?.notes ? `
        <div>
          <p style="color: #4B5563; margin: 0 0 4px 0;"><strong>Notes:</strong></p>
          <p style="color: #6B7280; margin: 0;">${meetingData.notes}</p>
        </div>
        ` : ''}
      </div>

      <!-- Action Buttons -->
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://www.eSignTap.com/${meetingData?.eventSlug}?rescheduleId=${meetingData?.eventId}" 
           style="display: inline-block; background: #4F46E5; color: white; padding: 14px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; margin: 8px;">
          Reschedule Meeting
        </a>
        <a href="https://www.eSignTap.com/${meetingData?.eventSlug}?rescheduleId=${meetingData?.eventId}" 
           style="display: inline-block; background: #DC2626; color: white; padding: 14px 24px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 14px; margin: 8px;">
          Cancel Meeting
        </a>
      </div>

      <p style="color: #6B7280; font-size: 14px; text-align: center; margin-top: 16px;">
        ${meetingData.isReschedule 
          ? 'The previous meeting has been canceled. You will receive a new calendar invitation shortly.'
          : 'The meeting has been added to your calendar. You will receive a calendar invitation separately.'}
      </p>
    </div>

    <!-- Footer -->
    <div style="background-color: #F3F4F6; padding: 24px; text-align: center; border-top: 1px solid #E5E7EB;">
      <p style="color: #6B7280; margin: 0; font-size: 14px;">© 2024 eSignTap. All rights reserved.</p>
      <div style="margin-top: 16px;">
        <a href="#" style="color: #4F46E5; text-decoration: none; margin: 0 8px; font-size: 14px;">Help Center</a>
        <a href="#" style="color: #4F46E5; text-decoration: none; margin: 0 8px; font-size: 14px;">Privacy Policy</a>
        <a href="#" style="color: #4F46E5; text-decoration: none; margin: 0 8px; font-size: 14px;">Terms of Service</a>
      </div>
    </div>
  </div>
</body>
</html>`
      },

      welcome: {
        subject: 'Welcome to eSignTap - Your AI-Powered Meeting Scheduler',
        text: (userData) => `
Dear ${userData.name},

Welcome to eSignTap! You've just unlocked a smarter way to schedule meetings.

Key Features:
- AI-Powered Scheduling: Intelligent time suggestions based on your preferences
- WhatsApp Reminders: Never miss a meeting with instant notifications
- Trusted by professionals worldwide
- Bank-grade encryption for your data security
- Smart conflict resolution
- Multi-timezone support

Start scheduling your first meeting now!

Best regards,
The eSignTap Team`,

        html: (userData) => `
<!DOCTYPE html>
<html>
<body style="font-family: 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f7fa;">
  <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); padding: 40px 20px; text-align: center;">
      <h1 style="color: #ffffff; margin: 0; font-size: 28px;">Welcome to eSignTap</h1>
      <p style="color: #E0E7FF; margin-top: 10px; font-size: 16px;">Your AI-Powered Meeting Assistant</p>
    </div>

    <!-- Main Content -->
    <div style="padding: 32px 24px;">
      <p style="font-size: 16px; color: #4B5563;">Dear ${userData?.name},</p>
      
      <p style="font-size: 16px; color: #4B5563; margin-bottom: 24px;">
        You've just unlocked a smarter way to schedule meetings. Here's what makes eSignTap special:
      </p>

      <!-- Feature Grid -->
      <div style="display: grid; gap: 20px; margin-bottom: 32px;">
        <!-- AI Scheduling -->
        <div style="padding: 16px; background-color: #F3F4F6; border-radius: 8px; border-left: 4px solid #4F46E5;">
          <h3 style="color: #1F2937; margin: 0 0 8px 0;">🤖 AI-Powered Scheduling</h3>
          <p style="color: #6B7280; margin: 0;">Smart scheduling that learns your preferences and suggests optimal meeting times.</p>
        </div>

        <!-- WhatsApp Integration -->
        <div style="padding: 16px; background-color: #F3F4F6; border-radius: 8px; border-left: 4px solid #10B981;">
          <h3 style="color: #1F2937; margin: 0 0 8px 0;">📱 WhatsApp Reminders</h3>
          <p style="color: #6B7280; margin: 0;">Get instant notifications and meeting updates right on WhatsApp.</p>
        </div>

        <!-- Custom Page -->
        <div style="padding: 16px; background-color: #F3F4F6; border-radius: 8px; border-left: 4px solid #F59E0B;">
          <h3 style="color: #1F2937; margin: 0 0 8px 0;">🛡️ Create custom page</h3>
          <p style="color: #6B7280; margin: 0;">Design a more detailed and branded custom page.</p>
        </div>
      </div>

      <!-- CTA Button -->
      <div style="text-align: center; margin: 32px 0;">
        <a href="https://www.eSignTap.com" target="_blank" style="display: inline-block; background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">Schedule Your First Meeting</a>
      </div>
    </div>

    <!-- Footer -->
    <div style="background-color: #F3F4F6; padding: 24px; text-align: center; border-top: 1px solid #E5E7EB;">
      <p style="color: #6B7280; margin: 0; font-size: 14px;">© 2024 eSignTap. All rights reserved.</p>
      <div style="margin-top: 16px;">
        <a href="#" style="color: #4F46E5; text-decoration: none; margin: 0 8px; font-size: 14px;">Help Center</a>
        <a href="#" style="color: #4F46E5; text-decoration: none; margin: 0 8px; font-size: 14px;">Privacy Policy</a>
        <a href="#" style="color: #4F46E5; text-decoration: none; margin: 0 8px; font-size: 14px;">Terms of Service</a>
      </div>
    </div>
  </div>
</body>
</html>`
      }
    };
  }

  async sendEmail({ to, subject, text, html, attachments = [] }) {
    try {
      const mailOptions = {
        from: process.env.GODADY_EMAIL || "info@eSignTap.com",
        to,
        subject,
        text,
        html,
        attachments
      };
      
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Email sent:', mailOptions.from);
      return { success: true, messageId: info.messageId };
    } catch (error) {
      console.error('Email send error:', error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  // Document signing emails
  async sendDocumentShareEmail(documentData) {
    console.log('=== EMAIL SERVICE DEBUG ===');
    console.log('📧 sendDocumentShareEmail called with:', JSON.stringify(documentData, null, 2));
    
    if (!documentData.signerEmail || !documentData.signerName || !documentData.documentTitle) {
      console.log('❌ Validation failed - missing required data:');
      console.log('  signerEmail:', !!documentData.signerEmail);
      console.log('  signerName:', !!documentData.signerName);
      console.log('  documentTitle:', !!documentData.documentTitle);
      throw new Error('Required document data is missing');
    }

    console.log('✅ Validation passed');

    const template = this.templates.documentShare;
    const emailData = {
      signerName: documentData.signerName,
      documentTitle: documentData.documentTitle,
      senderName: documentData.senderName,
      senderEmail: documentData.senderEmail,
      message: documentData.message,
      signingUrl: documentData.signingUrl,
      sentDate: this.formatDate(new Date())
    };

    console.log('📋 Processed email data:', JSON.stringify(emailData, null, 2));
    console.log('📧 Email subject:', template.getSubject(documentData.documentTitle));
    console.log('📧 Email to:', documentData.signerEmail);
    console.log('=== END EMAIL SERVICE DEBUG ===');

    try {
      const result = await this.sendEmail({
        to: documentData.signerEmail,
        subject: template.getSubject(documentData.documentTitle),
        text: template.text(emailData),
        html: template.html(emailData)
      });
      
      console.log('✅ Email sent successfully from sendDocumentShareEmail:', result);
      return result;
    } catch (error) {
      console.error('❌ Email failed in sendDocumentShareEmail:', error);
      throw error;
    }
  }

  async sendDocumentCompletedEmail(documentData) {
    if (!documentData.recipientEmail || !documentData.recipientName || !documentData.documentTitle) {
      throw new Error('Required document completion data is missing');
    }

    const template = this.templates.documentCompleted;
    const emailData = {
      recipientName: documentData.recipientName,
      documentTitle: documentData.documentTitle,
      completedDate: this.formatDate(new Date()),
      signers: documentData.signers || [],
      downloadUrl: documentData.downloadUrl
    };

    return this.sendEmail({
      to: documentData.recipientEmail,
      subject: template.getSubject(documentData.documentTitle),
      text: template.text(emailData),
      html: template.html(emailData)
    });
  }

  async sendDocumentCompletedEmailWithPDF(documentData, pdfBuffer) {
    console.log('=== EMAIL SERVICE PDF ATTACHMENT DEBUG ===');
    console.log('📧 sendDocumentCompletedEmailWithPDF called with:', {
      recipientEmail: documentData.recipientEmail,
      documentTitle: documentData.documentTitle,
      hasPdfBuffer: !!pdfBuffer
    });
    
    if (!documentData.recipientEmail || !documentData.recipientName || !documentData.documentTitle) {
      console.log('❌ Validation failed - missing required data:');
      console.log('  recipientEmail:', !!documentData.recipientEmail);
      console.log('  recipientName:', !!documentData.recipientName);
      console.log('  documentTitle:', !!documentData.documentTitle);
      throw new Error('Required document completion data is missing');
    }

    console.log('✅ Validation passed');

    const template = this.templates.documentCompleted;
    const emailData = {
      recipientName: documentData.recipientName,
      documentTitle: documentData.documentTitle,
      completedDate: this.formatDate(new Date()),
      signers: documentData.signers || [],
      downloadUrl: documentData.downloadUrl || '#'
    };

    const attachments = [];
    if (pdfBuffer) {
      attachments.push({
        filename: `${documentData.documentTitle}-signed.pdf`,
        content: pdfBuffer,
        contentType: 'application/pdf'
      });
      console.log('📎 PDF attachment added from buffer');
    }

    console.log('📋 Processed email data:', JSON.stringify(emailData, null, 2));
    console.log('📧 Email subject:', template.getSubject(documentData.documentTitle));
    console.log('📧 Email to:', documentData.recipientEmail);
    console.log('📎 Attachments:', attachments.length);
    console.log('=== END EMAIL SERVICE PDF DEBUG ===');

    try {
      const result = await this.sendEmail({
        to: documentData.recipientEmail,
        subject: template.getSubject(documentData.documentTitle),
        text: template.text(emailData),
        html: template.html(emailData),
        attachments: attachments
      });
      
      console.log('✅ Email with PDF attachment sent successfully:', result);
      return result;
    } catch (error) {
      console.error('❌ Email with PDF attachment failed:', error);
      throw error;
    }
  }

  // Existing eSignTap methods
  async sendWelcomeEmail(userData) {
    if (!userData.email || !userData.name) {
      throw new Error('Email and name are required for welcome email');
    }

    const template = this.templates.welcome;
    return this.sendEmail({
      to: userData.email,
      subject: template.subject,
      text: template.text(userData),
      html: template.html(userData)
    });
  }

  async sendMeetingInviteEmail(meetingData) {
    console.log('meetingData',meetingData);
    if (!meetingData.email || !meetingData.name || !meetingData.meetingDateTime || !meetingData.timeZone) {
      throw new Error('Required meeting data is missing');
    }

    const template = this.templates.meetingInvite;
    const enhancedMeetingData = {
      ...meetingData,
      isReschedule: !!meetingData.rescheduleId,
      meetingLink: meetingData.meetingLink || meetingData.hangoutLink || '--',
      meetingType: meetingData.meetingType || 'Online Meeting',
      eventSlug: meetingData.eventSlug || 'event',
      eventId: meetingData.eventId || '',
      getMeetingIcon: this.getMeetingIcon
    };

    return this.sendEmail({
      to: meetingData.email,
      subject: template.getSubject(enhancedMeetingData.isReschedule, meetingData.eventTitle),
      text: template.text(enhancedMeetingData),
      html: template.html(enhancedMeetingData)
    });
  }

  // Helper method to format dates
  formatDate(date) {
    if (!date) return '';
    try {
      return new Date(date).toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch (error) {
      console.error('Date formatting error:', error);
      return date.toString();
    }
  }

  // Helper method to format times if needed
  formatTime(date) {
    if (!date) return '';
    try {
      return new Date(date).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch (error) {
      console.error('Time formatting error:', error);
      return date.toString();
    }
  }
}

module.exports = new EmailService();