const { createClient } = require('@supabase/supabase-js');

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

exports.handler = async (event, context) => {
  // Check if this is a scheduled event from Netlify or a manual call
  const isScheduled = event.headers && event.headers['x-netlify-scheduled'];
  const authHeader = event.headers && event.headers.authorization;
  const apiKey = process.env.CLEANUP_API_KEY;
  
  // Verify authorization
  if (!isScheduled && (!apiKey || authHeader !== `Bearer ${apiKey}`)) {
    return {
      statusCode: 401,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }
  
  try {
    // Calculate date 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    if (event.httpMethod === 'GET') {
      // Count transactions older than 7 days
      const { data, error, count } = await supabase
        .from('transactions')
        .select('*', { count: 'exact' })
        .lt('timestamp', sevenDaysAgo.toISOString());
      
      if (error) {
        console.error('Error counting old transactions:', error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: error.message })
        };
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          oldTransactionsCount: count,
          oldestTransaction: data && data.length > 0 ? 
            new Date(data.sort((a, b) => 
              new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            )[0].timestamp) : null
        })
      };
    } else {
      // Delete transactions older than 7 days
      const { data, error, count } = await supabase
        .from('transactions')
        .delete({ count: 'exact' })
        .lt('timestamp', sevenDaysAgo.toISOString());
      
      if (error) {
        console.error('Error during transaction cleanup:', error);
        return {
          statusCode: 500,
          body: JSON.stringify({ error: error.message })
        };
      }
      
      return {
        statusCode: 200,
        body: JSON.stringify({ 
          success: true, 
          message: `Successfully deleted ${count} transactions older than 7 days`,
          deletedCount: count 
        })
      };
    }
  } catch (error) {
    console.error('Unexpected error during transaction cleanup:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}; 