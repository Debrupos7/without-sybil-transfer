import { NextResponse } from 'next/server';
import { supabase } from '@/utils/supabaseClient';

/**
 * API route to clean up transactions older than 7 days
 * Can be called by a cron job or manually by an admin
 */
export async function DELETE(request: Request) {
  try {
    // Check for API key in headers for security (compare with env variable)
    const authHeader = request.headers.get('authorization');
    const apiKey = process.env.CLEANUP_API_KEY;
    
    if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Calculate date 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Delete transactions older than 7 days
    const { data, error, count } = await supabase
      .from('transactions')
      .delete({ count: 'exact' })
      .lt('timestamp', sevenDaysAgo.toISOString());
    
    if (error) {
      console.error('Error during transaction cleanup:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ 
      success: true, 
      message: `Successfully deleted ${count} transactions older than 7 days`,
      deletedCount: count 
    });
    
  } catch (error: any) {
    console.error('Unexpected error during transaction cleanup:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * API route to get information about transactions that would be deleted
 * Useful for checking without actually deleting
 */
export async function GET(request: Request) {
  try {
    // Check for API key in headers for security (compare with env variable)
    const authHeader = request.headers.get('authorization');
    const apiKey = process.env.CLEANUP_API_KEY;
    
    if (!apiKey || authHeader !== `Bearer ${apiKey}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Calculate date 7 days ago
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    // Count transactions older than 7 days
    const { data, error, count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact' })
      .lt('timestamp', sevenDaysAgo.toISOString());
    
    if (error) {
      console.error('Error counting old transactions:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    
    return NextResponse.json({ 
      oldTransactionsCount: count,
      oldestTransaction: data && data.length > 0 ? 
        new Date(data.sort((a, b) => 
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )[0].timestamp) : null
    });
    
  } catch (error: any) {
    console.error('Unexpected error counting old transactions:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
} 