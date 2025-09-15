const express = require('express');
const router = express.Router();
const db = require('../db/database'); // Main database for paddle pledges
const smsDb = require('../db/sms-database'); // SMS database for text pledges

// Helper function to format currency for display
const formatCurrency = (cents) => {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
};

// Helper function to emit real-time updates
const emitTotalUpdate = async (io) => {
  try {
    // Get paddle totals from main database
    const paddleResult = await db.one(`
      SELECT COALESCE(SUM(total_cents), 0) AS paddle_total_cents
      FROM paddle_pledges
    `);
    
    // Get SMS totals from SMS database (amounts are in dollars, convert to cents)
    const smsResult = await smsDb.one(`
      SELECT COALESCE(SUM(pledge_amount * 100), 0) AS text_total_cents
      FROM sms_pledges
    `);
    
    const paddleTotalCents = parseInt(paddleResult.paddle_total_cents);
    const textTotalCents = parseInt(smsResult.text_total_cents);
    const grandTotalCents = paddleTotalCents + textTotalCents;
    
    console.log('Emitting totals update:', { 
      paddle: paddleTotalCents, 
      text: textTotalCents, 
      grand: grandTotalCents 
    });
    
    io.emit('totals_updated', {
      grandTotal: grandTotalCents,
      paddleTotal: paddleTotalCents,
      textTotal: textTotalCents,
      grandTotalFormatted: formatCurrency(grandTotalCents),
      paddleTotalFormatted: formatCurrency(paddleTotalCents),
      textTotalFormatted: formatCurrency(textTotalCents),
      goalPercentage: Math.min((grandTotalCents / 100000000) * 100, 100) // $1M goal
    });
  } catch (error) {
    console.error('Error emitting total update:', error);
  }
};

// Track last known text pledge count to detect new ones
let lastTextPledgeCount = 0;

// Function to check for new SMS pledges and emit updates
const checkForNewTextPledges = async (io) => {
  try {
    const result = await smsDb.one(`
      SELECT COUNT(*) as count FROM sms_pledges
    `);
    
    const currentCount = parseInt(result.count);
    
    if (currentCount > lastTextPledgeCount) {
      console.log(`New SMS pledges detected: ${currentCount - lastTextPledgeCount} new pledges`);
      lastTextPledgeCount = currentCount;
      await emitTotalUpdate(io);
    }
  } catch (error) {
    console.error('Error checking for new SMS pledges:', error);
  }
};

// GET /api/totals - Get current totals
router.get('/totals', async (req, res) => {
  try {
    // Get paddle totals from main database
    const paddleResult = await db.one(`
      SELECT COALESCE(SUM(total_cents), 0) AS paddle_total_cents
      FROM paddle_pledges
    `);
    
    // Get SMS totals from SMS database (amounts are in dollars, convert to cents)
    const smsResult = await smsDb.one(`
      SELECT COALESCE(SUM(pledge_amount * 100), 0) AS text_total_cents
      FROM sms_pledges
    `);
    
    const paddleTotalCents = parseInt(paddleResult.paddle_total_cents);
    const textTotalCents = parseInt(smsResult.text_total_cents);
    const grandTotalCents = paddleTotalCents + textTotalCents;
    
    res.json({
      grandTotal: grandTotalCents,
      paddleTotal: paddleTotalCents,
      textTotal: textTotalCents,
      grandTotalFormatted: formatCurrency(grandTotalCents),
      paddleTotalFormatted: formatCurrency(paddleTotalCents),
      textTotalFormatted: formatCurrency(textTotalCents),
      goalPercentage: Math.min((grandTotalCents / 100000000) * 100, 100) // $1M goal
    });
  } catch (error) {
    console.error('Error fetching totals:', error);
    res.status(500).json({ error: 'Failed to fetch totals' });
  }
});

// GET /api/paddle-pledges - Get all paddle pledge tiers
router.get('/paddle-pledges', async (req, res) => {
  try {
    const pledges = await db.any(`
      SELECT 
        tier_cents,
        count,
        total_cents,
        tier_cents / 100 as tier_dollars
      FROM paddle_pledges 
      ORDER BY tier_cents DESC
    `);
    
    res.json(pledges.map(pledge => ({
      ...pledge,
      tierFormatted: formatCurrency(pledge.tier_cents),
      totalFormatted: formatCurrency(pledge.total_cents)
    })));
  } catch (error) {
    console.error('Error fetching paddle pledges:', error);
    res.status(500).json({ error: 'Failed to fetch paddle pledges' });
  }
});

// PUT /api/paddle-pledges/:tierCents - Update paddle pledge count
router.put('/paddle-pledges/:tierCents', async (req, res) => {
  try {
    const { tierCents } = req.params;
    const { count } = req.body;
    
    if (typeof count !== 'number' || count < 0) {
      return res.status(400).json({ error: 'Count must be a non-negative number' });
    }
    
    const updated = await db.one(`
      UPDATE paddle_pledges 
      SET count = $1, updated_at = NOW() 
      WHERE tier_cents = $2 
      RETURNING *
    `, [count, tierCents]);
    
    // Emit real-time update
    await emitTotalUpdate(req.io);
    
    res.json({
      ...updated,
      tierFormatted: formatCurrency(updated.tier_cents),
      totalFormatted: formatCurrency(updated.total_cents)
    });
  } catch (error) {
    console.error('Error updating paddle pledge:', error);
    res.status(500).json({ error: 'Failed to update paddle pledge' });
  }
});

// GET /api/text-pledges - Get recent SMS pledges
router.get('/text-pledges', async (req, res) => {
  try {
    const pledges = await smsDb.any(`
      SELECT 
        id,
        pledge_amount,
        phone_number,
        message_text as message,
        timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'America/New_York' as created_at,
        pledge_amount as amount_dollars
      FROM sms_pledges 
      ORDER BY timestamp DESC 
      LIMIT 50
    `);
    
    res.json(pledges.map(pledge => ({
      ...pledge,
      amount_cents: Math.round(pledge.pledge_amount * 100), // Convert dollars to cents
      amountFormatted: formatCurrency(Math.round(pledge.pledge_amount * 100))
    })));
  } catch (error) {
    console.error('Error fetching SMS pledges:', error);
    res.status(500).json({ error: 'Failed to fetch SMS pledges' });
  }
});

// DELETE /api/reset - Reset all pledge data (admin function)
router.delete('/reset', async (req, res) => {
  try {
    // Reset paddle pledges in main database
    await db.func('reset_pledge_data');
    
    // Reset SMS pledges in SMS database
    await smsDb.none('DELETE FROM sms_pledges');
    console.log('SMS pledges cleared from Supabase database');
    
    // Reset the polling counter
    lastTextPledgeCount = 0;
    
    // Emit real-time update
    await emitTotalUpdate(req.io);
    
    res.json({ message: 'All pledge data has been reset (paddle + SMS)' });
  } catch (error) {
    console.error('Error resetting pledge data:', error);
    res.status(500).json({ error: 'Failed to reset pledge data' });
  }
});

// DELETE /api/reset-sms - Reset only SMS pledge data (admin function)
router.delete('/reset-sms', async (req, res) => {
  try {
    // Reset SMS pledges in SMS database only
    await smsDb.none('DELETE FROM sms_pledges');
    console.log('SMS pledges cleared from Supabase database');
    
    // Reset the polling counter
    lastTextPledgeCount = 0;
    
    // Emit real-time update
    await emitTotalUpdate(req.io);
    
    res.json({ message: 'SMS pledge data has been reset' });
  } catch (error) {
    console.error('Error resetting SMS data:', error);
    res.status(500).json({ error: 'Failed to reset SMS data' });
  }
});

// POST /api/webhook/simpletexting - Handle SimpleTexting webhook (placeholder for later)
router.post('/webhook/simpletexting', async (req, res) => {
  // TODO: Implement SimpleTexting webhook handling
  console.log('SimpleTexting webhook received:', req.body);
  res.json({ message: 'Webhook received (not implemented yet)' });
});

// Export router and polling function
module.exports = { router, checkForNewTextPledges };
