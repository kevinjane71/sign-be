// payment.js - Formio Payment API for Razorpay integration
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

// Initialize routes using shared database instance
const initializePaymentRoutes = (db, razorpay) => {
  // 1. Create Order API
  router.post('/create-order', async (req, res) => {
    try {
      const { amount, currency = 'INR', planId, email } = req.body;
      
      // Validate required fields
      if (!amount || !planId || !email ) {
        return res.status(400).json({
          success: false,
          error: 'Missing required fields: amount, planId, email, and  are required'
        });
      }
      
      const amountInPaise = Math.round(Number(amount) * 100);

      console.log('[PAYMENT] Creating order with amount:', {
        originalAmount: amount,
        amountInPaise: amountInPaise,
        planId,
        email
      });

      // Create Razorpay order
      const order = await razorpay.orders.create({
        amount: amountInPaise, // convert to paise
        currency,
        receipt: `esigntap_${Date.now()}`,
        notes: {
          planId,
          email,
          app: 'Snapyform' // Add app name to identify in webhook
        }
      });

      // Store order in database
      await db.collection('esigntap_orders').doc(order.id).set({
        orderId: order.id,
        amount: amountInPaise,
        currency,
        planId,
        email,
        app: 'Snapyform', // Also store app name in database
        status: 'created',
        createdAt: new Date()
      });

      res.json({ 
        success: true, 
        order: {
          id: order.id,
          amount: order.amount,
          currency: order.currency
        }
      });

    } catch (error) {
      console.error('[PAYMENT] Order creation error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Failed to create order',
        details: error.message
      });
    }
  });

  // 2. Verify Payment API
  router.post('/verify', async (req, res) => {
    try {
      const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature,
        planId,
        userId
      } = req.body;

      // Verify signature
      const shasum = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET);
      shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
      const digest = shasum.digest('hex');

      if (digest !== razorpay_signature) {
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid signature' 
        });
      }

      // Get order details from database
      const orderDoc = await db.collection('esigntap_orders').doc(razorpay_order_id).get();

      if (!orderDoc.exists) {
        return res.status(404).json({ 
          success: false, 
          error: 'Order not found' 
        });
      }

      const orderData = orderDoc.data();

      // Create payment record
      const paymentRef = db.collection('esigntap_payments').doc(razorpay_payment_id);
      const paymentDoc = {
        orderId: razorpay_order_id,
        paymentId: razorpay_payment_id,
        signature: razorpay_signature,
        planId: planId || orderData.planId,
        email: orderData.email,
        userId: userId || orderData.userId,
        amount: orderData.amount,
        currency: orderData.currency,
        app: 'Snapyform', // Add app name
        status: 'verified',
        verifiedAt: new Date()
      };

      await paymentRef.set(paymentDoc);

      // Update order status
      await db.collection('esigntap_orders').doc(razorpay_order_id).update({
        status: 'paid',
        paymentId: razorpay_payment_id,
        updatedAt: new Date()
      });

      // Update user subscription
      await updateUserSubscription(db, orderData.userId, orderData.email, orderData.planId || planId);

      res.json({ 
        success: true, 
        message: 'Payment verified successfully',
        data: {
          planId: orderData.planId || planId,
          paymentId: razorpay_payment_id,
          email: orderData.email,
          orderId: razorpay_order_id,
          app: 'Snapyform' // Include app name in response
        }
      });

    } catch (error) {
      console.error('[PAYMENT] Payment verification error:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Payment verification failed',
        details: error.message
      });
    }
  });

  // 3. Webhook Handler for automated payment notifications
  router.post('/webhook', 
    express.raw({ type: 'application/json' }), 
    async (req, res) => {
      try {
        // Verify webhook signature
        const signature = req.headers['x-razorpay-signature'];
        const shasum = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET);
        shasum.update(JSON.stringify(req.body));
        const digest = shasum.digest('hex');

        if (digest !== signature) {
          return res.status(400).json({ error: 'Invalid webhook signature' });
        }

        const event = req.body.event;
        const payment = req.body.payload.payment?.entity;
        
        if (!payment) {
          return res.status(400).json({ error: 'Invalid payment data in webhook' });
        }

        // FIRST check if this webhook is for Snapyform by examining the order notes
        try {
          const orderInfo = await razorpay.orders.fetch(payment.order_id);
          const appName = orderInfo.notes?.app || 'Unknown';
          
          // If this webhook is not for Snapyform, acknowledge it and return immediately
          if (appName !== 'Snapyform') {
            console.log(`[PAYMENT] Ignoring webhook for app: ${appName}, not for Snapyform`);
            return res.json({ 
              status: 'ok', 
              message: 'Webhook acknowledged but ignored - not for Snapyform'
            });
          }
          
          console.log(`[PAYMENT] Processing webhook for Snapyform:`, {
            paymentId: payment.id,
            orderId: payment.order_id,
            status: payment.status,
            event: event
          });
          
          // Create webhook record
          const webhookDoc = {
            fullPayload: req.body,
            webhookReceivedAt: new Date(),
            event,
            orderId: payment.order_id,
            paymentId: payment.id,
            status: payment.status || null,
            amount: payment.amount,
            currency: payment.currency,
            app: 'Snapyform'
          };

          // Store in esigntap_webhook_events collection
          await db.collection('esigntap_webhook_events').add(webhookDoc);

          // Handle specific events for Snapyform app
          if (event === 'payment.captured' || event === 'payment.authorized') {
            // Get order details
            const orderDoc = await db.collection('esigntap_orders').doc(payment.order_id).get();
            
            if (orderDoc.exists) {
              const orderData = orderDoc.data();
              
              // Update order status if it's not already paid
              if (orderData.status !== 'paid') {
                await db.collection('esigntap_orders').doc(payment.order_id).update({
                  status: 'paid',
                  paymentId: payment.id,
                  updatedAt: new Date()
                });
              }

              // Create or update payment record
              const paymentRef = db.collection('esigntap_payments').doc(payment.id);
              const paymentDoc = await paymentRef.get();
              
              if (!paymentDoc.exists) {
                await paymentRef.set({
                  orderId: payment.order_id,
                  paymentId: payment.id,
                  planId: orderData.planId,
                  email: orderData.email,
                  userId: orderData.userId,
                  amount: payment.amount,
                  currency: payment.currency,
                  status: payment.status,
                  app: 'Snapyform',
                  webhookAt: new Date()
                });
              }

              // Update user subscription
              await updateUserSubscription(db, orderData.userId, orderData.email, orderData.planId);
              console.log(`[PAYMENT] Successfully processed payment for Snapyform, userId: ${orderData.userId}`);
            } else {
              console.log(`[PAYMENT] Order ${payment.order_id} not found for webhook ${event}`);
            }
          }
          
          // Send success response
          return res.json({ status: 'ok', message: 'Webhook processed successfully for Snapyform' });
          
        } catch (orderError) {
          console.error('[PAYMENT] Failed to fetch order details:', orderError);
          // If we can't determine the app, respond with an error
          return res.status(500).json({ 
            error: 'Error determining app ownership',
            details: orderError.message
          });
        }

      } catch (error) {
        console.error('[PAYMENT] Webhook error:', error);
        res.status(500).json({ error: 'Internal server error' });
      }
  });

  // 4. Get Payment History API
  router.get('/history/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const { limit = 10 } = req.query;

      // Validate userId
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }

      // Get payment history for user
      const paymentsSnapshot = await db.collection('esigntap_payments')
        .where('userId', '==', userId)
        .where('app', '==', 'Snapyform') // Filter by app name
        .orderBy('verifiedAt', 'desc')
        .limit(parseInt(limit))
        .get();

      const payments = [];
      paymentsSnapshot.forEach(doc => {
        const data = doc.data();
        payments.push({
          paymentId: doc.id,
          orderId: data.orderId,
          planId: data.planId,
          amount: data.amount / 100, // Convert from paise to currency units
          currency: data.currency,
          status: data.status,
          date: data.verifiedAt ? data.verifiedAt.toDate() : null
        });
      });

      res.json({
        success: true,
        data: payments
      });

    } catch (error) {
      console.error('[PAYMENT] Error fetching payment history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch payment history',
        details: error.message
      });
    }
  });

  // 5. Get Current Plan API
  router.get('/plan/:userId', async (req, res) => {
    try {
      const { userId } = req.params;

      // Validate userId
      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }

      // Get user document to check subscription
      const userDoc = await db.collection('esigntap_user_data').doc(userId).get();

      if (!userDoc.exists) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const userData = userDoc.data();
      const subscription = userData.subscription || {
        planId: 'free',
        planName: 'Free Plan',
        status: 'active',
        startDate: new Date().toISOString(),
        endDate: null,
        features: getFeaturesByPlan('free')
      };

      res.json({
        success: true,
        data: subscription
      });

    } catch (error) {
      console.error('[PAYMENT] Error fetching current plan:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to fetch current plan',
        details: error.message
      });
    }
  });

  // 6. Get Billing Information API
  router.post('/billing', async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          error: 'Email is required'
        });
      }

      // Find user document
      const usersRef = db.collection('esigntap_user_data');
      const userSnapshot = await usersRef
        .where('email', '==', email)
        .limit(1)
        .get();

      if (userSnapshot.empty) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const userData = userSnapshot.docs[0].data();
      
      // Get subscription data from user document
      const subscription = userData.subscription || {};
      
      // Format as billing object
      const billingData = {
        currentPlan: subscription.planId || 'free',
        planName: subscription.planName || 'Free Plan',
        status: subscription.status || 'active',
        nextBillingDate: subscription.endDate || 'NA',
        lastPaymentDate: subscription.startDate || 'NA',
        features: subscription.features || getFeaturesByPlan('free'),
        lastUpdated: subscription.lastUpdated || new Date().toISOString()
      };

      return res.status(200).json({
        success: true,
        billing: billingData
      });

    } catch (error) {
      console.error('[PAYMENT] Error fetching billing data:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Internal server error'
      });
    }
  });

  return router;
};

// Helper function to update user subscription
async function updateUserSubscription(db, userId, email, planId) {
  try {
    console.log(`[PAYMENT] Updating subscription for user: ${userId}, plan: ${planId}`);
    
    if (!userId) {
      throw new Error('User ID is required for subscription update');
    }
    
    const userRef = db.collection('esigntap_user_data').doc(userId);
    const userDoc = await userRef.get();
    
    if (!userDoc.exists) {
      // Try to find by email as fallback
      if (email) {
        const userByEmailSnapshot = await db.collection('esigntap_user_data')
          .where('email', '==', email)
          .limit(1)
          .get();
        
        if (!userByEmailSnapshot.empty) {
          const userFoundByEmail = userByEmailSnapshot.docs[0];
          return updateUserSubscriptionDoc(userFoundByEmail.ref, planId);
        }
      }
      throw new Error(`User not found with ID: ${userId} or email: ${email}`);
    }
    
    return updateUserSubscriptionDoc(userRef, planId);
  } catch (error) {
    console.error('[PAYMENT] Update subscription error:', error);
    throw error;
  }
}

// Helper function to update the user document with subscription data
async function updateUserSubscriptionDoc(userRef, planId) {
  const currentDate = new Date();
  const endDate = new Date(currentDate);
  
  // Set end date based on plan (default to 1 month)
  switch (planId) {
    case 'yearly':
      endDate.setFullYear(endDate.getFullYear() + 1);
      break;
    case 'quarterly':
      endDate.setMonth(endDate.getMonth() + 3);
      break;
    default:
      endDate.setMonth(endDate.getMonth() + 1); // Monthly plan
  }
  
  // Get plan details
  const planDetails = getPlanDetails(planId);
  
  // Update user document with subscription information
  await userRef.update({
    subscription: {
      planId,
      planName: planDetails.name,
      status: 'active',
      startDate: currentDate.toISOString(),
      endDate: endDate.toISOString(),
      features: planDetails.features,
      lastUpdated: currentDate.toISOString(),
      app: 'Snapyform' // Add app name
    },
    lastUpdated: currentDate
  });
  
  return true;
}

// Helper function to get plan details
function getPlanDetails(planId) {
  const plans = {
    'free': {
      name: 'Free Plan',
      features: getFeaturesByPlan('free')
    },
    'basic': {
      name: 'Basic Plan',
      features: getFeaturesByPlan('basic')
    },
    'pro': {
      name: 'Pro Plan',
      features: getFeaturesByPlan('pro')
    },
    'monthly': {
      name: 'Monthly Plan',
      features: getFeaturesByPlan('pro')
    },
    'quarterly': {
      name: 'Quarterly Plan',
      features: getFeaturesByPlan('pro')
    },
    'yearly': {
      name: 'Annual Plan',
      features: getFeaturesByPlan('pro')
    }
  };
  
  return plans[planId] || plans['free'];
}

// Helper function to get features by plan
function getFeaturesByPlan(planId) {
  switch (planId) {
    case 'pro':
      return {
        maxForms: 100,
        maxResponsesPerForm: 10000,
        fileUploadsEnabled: true,
        customDomainEnabled: true,
        brandingRemoved: true,
        prioritySupport: true,
        googleSheetsSync: true,
        advancedAnalytics: true
      };
    case 'basic':
      return {
        maxForms: 20,
        maxResponsesPerForm: 1000,
        fileUploadsEnabled: true,
        customDomainEnabled: false,
        brandingRemoved: true,
        prioritySupport: false,
        googleSheetsSync: true,
        advancedAnalytics: false
      };
    case 'free':
    default:
      return {
        maxForms: 3,
        maxResponsesPerForm: 100,
        fileUploadsEnabled: false,
        customDomainEnabled: false,
        brandingRemoved: false,
        prioritySupport: false,
        googleSheetsSync: true,
        advancedAnalytics: false
      };
  }
}

module.exports = initializePaymentRoutes; 