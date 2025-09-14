const pgp = require('pg-promise')();

// Database connection configuration
const dbConfig = {
  host: process.env.PG_HOST,
  port: process.env.PG_PORT || 5432,
  database: process.env.PG_DATABASE,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
};

const db = pgp(dbConfig);

// Test connection
db.connect()
  .then(obj => {
    console.log('Database connected successfully');
    obj.done(); // success, release connection
  })
  .catch(error => {
    console.error('Database connection error:', error);
  });

module.exports = db;
