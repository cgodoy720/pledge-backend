const express = require('express');
const router = express.Router();
const db = require('../db/database');

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
    // Get totals with a more reliable query
    const result = await db.one(`
      SELECT 
        COALESCE((SELECT SUM(total_cents) FROM paddle_pledges), 0) AS paddle_total_cents,
        COALESCE((SELECT SUM(amount_cents) FROM text_pledges), 0) AS text_total_cents,
        COALESCE((SELECT SUM(total_cents) FROM paddle_pledges), 0) + 
        COALESCE((SELECT SUM(amount_cents) FROM text_pledges), 0) AS grand_total_cents
    `);
    
    console.log('Emitting totals update:', result); // Debug log
    
    io.emit('totals_updated', {
      grandTotal: result.grand_total_cents,
      paddleTotal: result.paddle_total_cents,
      textTotal: result.text_total_cents,
      grandTotalFormatted: formatCurrency(result.grand_total_cents),
      paddleTotalFormatted: formatCurrency(result.paddle_total_cents),
      textTotalFormatted: formatCurrency(result.text_total_cents),
      goalPercentage: Math.min((result.grand_total_cents / 100000000) * 100, 100) // $1M goal
    });
  } catch (error) {
    console.error('Error emitting total update:', error);
  }
};

// GET /api/totals - Get current totals
router.get('/totals', async (req, res) => {
  try {
    const result = await db.one(`
      SELECT 
        COALESCE((SELECT SUM(total_cents) FROM paddle_pledges), 0) AS paddle_total_cents,
        COALESCE((SELECT SUM(amount_cents) FROM text_pledges), 0) AS text_total_cents,
        COALESCE((SELECT SUM(total_cents) FROM paddle_pledges), 0) + 
        COALESCE((SELECT SUM(amount_cents) FROM text_pledges), 0) AS grand_total_cents
    `);
    
    res.json({
      grandTotal: result.grand_total_cents,
      paddleTotal: result.paddle_total_cents,
      textTotal: result.text_total_cents,
      grandTotalFormatted: formatCurrency(result.grand_total_cents),
      paddleTotalFormatted: formatCurrency(result.paddle_total_cents),
      textTotalFormatted: formatCurrency(result.text_total_cents),
      goalPercentage: Math.min((result.grand_total_cents / 100000000) * 100, 100) // $1M goal
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

// GET /api/text-pledges - Get recent text pledges
router.get('/text-pledges', async (req, res) => {
  try {
    const pledges = await db.any(`
      SELECT 
        amount_cents,
        phone_number,
        message,
        created_at,
        amount_cents / 100 as amount_dollars
      FROM text_pledges 
      ORDER BY created_at DESC 
      LIMIT 50
    `);
    
    res.json(pledges.map(pledge => ({
      ...pledge,
      amountFormatted: formatCurrency(pledge.amount_cents)
    })));
  } catch (error) {
    console.error('Error fetching text pledges:', error);
    res.status(500).json({ error: 'Failed to fetch text pledges' });
  }
});

// DELETE /api/reset - Reset all pledge data (admin function)
router.delete('/reset', async (req, res) => {
  try {
    await db.func('reset_pledge_data');
    
    // Emit real-time update
    await emitTotalUpdate(req.io);
    
    res.json({ message: 'All pledge data has been reset' });
  } catch (error) {
    console.error('Error resetting pledge data:', error);
    res.status(500).json({ error: 'Failed to reset pledge data' });
  }
});

// POST /api/webhook/simpletexting - Handle SimpleTexting webhook (placeholder for later)
router.post('/webhook/simpletexting', async (req, res) => {
  // TODO: Implement SimpleTexting webhook handling
  console.log('SimpleTexting webhook received:', req.body);
  res.json({ message: 'Webhook received (not implemented yet)' });
});

module.exports = router;
