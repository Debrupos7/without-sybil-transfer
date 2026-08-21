// Scheduled function to trigger cleanup daily at midnight
const axios = require('axios');

exports.handler = async function(event, context) {
  try {
    console.log('Running scheduled cleanup task');
    
    // Get the deployed URL from environment or construct it
    const baseUrl = process.env.URL || 'https://your-netlify-site.netlify.app';
    
    // Call the cleanup function with the scheduled header
    const response = await axios({
      method: 'DELETE',
      url: `${baseUrl}/.netlify/functions/cleanup-transactions`,
      headers: {
        'x-netlify-scheduled': 'true'
      }
    });
    
    console.log('Cleanup completed:', response.data);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Scheduled cleanup completed successfully',
        result: response.data
      })
    };
  } catch (error) {
    console.error('Error in scheduled cleanup:', error);
    
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: 'Error running scheduled cleanup',
        error: error.message
      })
    };
  }
}; 