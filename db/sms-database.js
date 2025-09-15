const pgp = require('pg-promise')();

// SMS Database configuration (Supabase)
const smsDbConfig = {
  connectionString: process.env.SMS_DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

const smsDb = pgp(smsDbConfig);

// Test connection
smsDb.connect()
  .then(obj => {
    console.log('SMS Database (Supabase) connected successfully');
    obj.done(); // success, release connection
  })
  .catch(error => {
    console.error('SMS Database connection error:', error);
  });

module.exports = smsDb;
