export const formatControllerError = (error, context) => {
  console.error(`Error in ${context}:`, error);

  // Default error response
  const defaultError = {
    status: 500,
    error: 'Internal Server Error',
    message: 'An unexpected error occurred'
  };

  // Handle specific error types
  if (error.response) {
    // Error from external API
    return {
      status: error.response.status,
      error: 'External API Error',
      message: error.response.data?.message || error.message
    };
  } else if (error.code === 'ECONNREFUSED') {
    // Connection error
    return {
      status: 503,
      error: 'Service Unavailable',
      message: 'Unable to connect to external service'
    };
  } else if (error.message.includes('Invalid')) {
    // Validation error
    return {
      status: 400,
      error: 'Validation Error',
      message: error.message
    };
  }

  // Return default error if no specific handling
  return defaultError;
}; 