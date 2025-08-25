const cron = require('node-cron');
const TokenService = require('./token.service');

class CronService {
  static init() {
    // ล้าง expired tokens ทุกวันเวลา 02:00 น.
    cron.schedule('0 2 * * *', async () => {
      console.log('Running cleanup expired tokens...');
      try {
        await TokenService.cleanupExpiredTokens();
        console.log('Cleanup completed successfully');
      } catch (error) {
        console.error('Cleanup failed:', error);
      }
    });

    // ล้าง expired tokens ทุก 6 ชั่วโมง (สำรอง)
    cron.schedule('0 */6 * * *', async () => {
      console.log('Running backup cleanup expired tokens...');
      try {
        await TokenService.cleanupExpiredTokens();
        console.log('Backup cleanup completed successfully');
      } catch (error) {
        console.error('Backup cleanup failed:', error);
      }
    });

    console.log('Cron jobs initialized');
  }
}

module.exports = CronService;
