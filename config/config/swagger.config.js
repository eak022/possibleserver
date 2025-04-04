const swaggerConfig = {
    getBaseUrl: () => {
      return process.env.NODE_ENV === 'production'
        ? 'https://possibleserver.onrender.com'  // กำหนดค่าตรงๆ สำหรับ production
        : process.env.DEV_API_URL;
    },
    
    getSwaggerOptions: () => {
      const baseUrl = process.env.NODE_ENV === 'production'
        ? 'https://possibleserver.onrender.com'  // กำหนดค่าตรงๆ สำหรับ production
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