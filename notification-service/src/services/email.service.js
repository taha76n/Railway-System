import {createTransport} from "nodemailer";
import { config } from "../../../user-service/src/configs";
import { logger } from "../../../user-service/src/configs/logger";
import {getOtpTemplate, getWelcomeTemplate} from "../templates/index";


class EmailService {
  constructor() {
    this.from = config.SMTP_USER
    this.maxRetries = 3

    this.transporter = createTransport({
      service: "gmail",
      auth: {
        user: config.SMTP_USER,
        pass: config.SMTP_PASS
      }
    })
  }

  async sendWithRetry (msg, retries = 0) {
    try {
      await this.transporter.sendMail(msg);
      logger.info(`Email sent successfully to ${msg.to}`, {
        subject: msg.subject,
        attempts: retries + 1
      })
      return {success: true}
    } catch (error) {
      logger.error(`Email sending failed (attempts ${retries + 1}/ ${this.maxRetries})`, {
        to: msg.to,
        error: error.message,
        code: error.code
      }) 
    }

    if (retries < this.maxRetries) {
      const delay = Math.pow(2, retries) * 1000;

      await new Promise (resolve => setTimeout(resolve, delay));

      this.sendWithRetry(msg, retries + 1);
    }
    throw error;

  }


async sendOtpEmail (email, otp, ttlMinutes) {
  const msg = {
    to: email,
    from: config.SMTP_USER,
    subject: `Your Railway User Verification Code`,
    html: getOtpTemplate(otp, ttlMinutes)
  }
  return this.sendWithRetry(msg)
}

async sendWelcomeEmail (email, firstName) {
  const msg = {
    to: email,
    from: config.SMTP_USER,
    subject: `Welcome to Railway Backend System`,
    html: getWelcomeTemplate(firstName)
  }
  return this.sendWithRetry(msg);
}
}
export default new EmailService();