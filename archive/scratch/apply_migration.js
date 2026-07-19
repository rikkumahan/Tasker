const fs = require('fs');
const { Client } = require('pg');

async function runMigration() {
    const connectionString = 'postgresql://postgres.esngoeuhtpdzyfttofyu:z3J$LzM5bJc9!kX@aws-0-ap-south-1.pooler.supabase.com:6543/postgres';
    
    const client = new Client({
        connectionString,
        ssl: { rejectUnauthorized: false }
    });
    
    try {
        await client.connect();
        const sql = fs.readFileSync('../supabase/migrations/017_action_context_retrieval.sql', 'utf8');
        await client.query(sql);
        console.log('Migration applied successfully!');
    } catch (e) {
        console.error('Error applying migration:', e);
    } finally {
        await client.end();
    }
}

runMigration();
