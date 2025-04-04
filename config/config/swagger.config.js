const swaggerConfig = {
    getBaseUrl: () => {
      return process.env.NODE_ENV === 'production'
        ? process.env.PROD_API_URL
        : process.env.DEV_API_URL;
    },
    
    getSwaggerOptions: () => {
      const baseUrl = process.env.NODE_ENV === 'production'
        ? process.env.PROD_API_URL
        : process.env.DEV_API_URL;
  
      return {
        explorer: true,
        swaggerOptions: {
          urls: [
            {
              url: `${baseUrl}/swagger.json`,
              name: process.env.NODE_ENV === 'production' ? 'Production' : 'Development'
            }
          ]
        }
      };
    }
  };
  
  module.exports = swaggerConfig;