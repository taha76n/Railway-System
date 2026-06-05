import {safepayCore} from "@sfpy/node-core";
import {crypto} from "crypto";
import {logger} from "../../configs/logger.js"
import BaseGateway from "./base.gateway.js";

class SafepayGateway extends BaseGateway {
     constructor(secretKey, webhookSecret, environment = 'sandbox') {
          super('safepay');
          
          this.secretKey = secretKey;
          this.webhookSecret = webhookSecret;
          this.environment = environment;
          
          const host = environment === 'production' 
               ? 'https://api.getsafepay.com' 
               : 'https://sandbox.api.getsafepay.com';

          this.client = safepayCore(this.secretKey, {
               authType: 'secret',
               host: host
          });
     }

     async createOrder(amount, currency = 'PKR', receipt, notes = {}) {
          let session;
          try {
               session = await this.client.payments.session.setup({
                    amount: amount, // Safepay uses standard decimals, no need for amount * 100
                    currency: currency,
                    environment: this.environment,
                    cancel_url: notes.cancelUrl || 'http://localhost:3000/cancel',
                    success_url: notes.successUrl || 'http://localhost:3000/success',
               });
          } catch (err) {
               const description = err?.error?.message || err?.message || JSON.stringify(err);
               logger.error(`Safepay createOrder failed: ${description}`);
               const { BadRequestError } = require('../../utils/error');
               throw new BadRequestError(`Payment gateway error: ${description}`, 'PAYMENT_GATEWAY_ERROR');
          }

          const trackerId = session.data.tracker;
          logger.info(`Safepay tracker created: ${trackerId}`, { receipt, amount });

          return {
               gatewayOrderId: trackerId,
               amount: amount,
               currency: currency,
               receipt: receipt,
               rawResponse: session.data,
          };
     }

     // Notice we kept paymentId to match your BaseGateway, even though Safepay doesn't hash it
     verifyPaymentSignature(orderId, paymentId, signature) {
          // Safepay verifies payments by hashing ONLY the tracker (orderId) with your Secret Key
          const expectedSignature = crypto
               .createHmac('sha256', this.secretKey)
               .update(orderId)
               .digest('hex');

          return crypto.timingSafeEqual(
               Buffer.from(expectedSignature, 'hex'),
               Buffer.from(signature, 'hex')
          );
     }

     verifyWebhookSignature(rawBody, signature) {
          const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
          const expectedSignature = crypto
               .createHmac('sha256', this.webhookSecret)
               .update(body)
               .digest('hex');

          try {
               return crypto.timingSafeEqual(
                    Buffer.from(expectedSignature, 'hex'),
                    Buffer.from(signature, 'hex')
               );
          } catch {
               return false;
          }
     }

     // We map paymentId to Safepay's tracker ID
     async fetchPayment(paymentId) {
          try {
               const payment = await this.client.order.tracker.action({ tracker: paymentId });
               
               return {
                    status: payment.data.state, 
                    amount: payment.data.amount,
                    method: payment.data.payment_method,
                    rawResponse: payment.data,
               };
          } catch(err) {
               logger.error(`Safepay fetchPayment failed for ${paymentId}:`, err);
               throw err;
          }
     }

     // We map paymentId to Safepay's tracker ID
     async initiateRefund(paymentId, amount, notes = {}) {
          try {
               const refund = await this.client.payments.refund({
                    tracker: paymentId,
                    amount: amount
               });

               logger.info(`Safepay refund initiated for tracker: ${paymentId}`, { amount });

               return {
                    gatewayRefundId: refund.data.refund_id,
                    status: refund.data.state,
                    amount: refund.data.amount,
                    rawResponse: refund.data,
               };
          } catch(err) {
               logger.error(`Safepay initiateRefund failed:`, err);
               throw err;
          }
     }
     
     // Added fetchRefund to fully complete your interface
     async fetchRefund(paymentId, refundId) {
          // Note: Safepay does not have a dedicated fetchRefund endpoint in the Node SDK by default,
          // so fetching the payment/tracker status returns the overall refund state.
          const payment = await this.fetchPayment(paymentId);
          
          return {
               status: payment.status, 
               amount: payment.amount, 
               rawResponse: payment.rawResponse,
          };
     }
}

export default SafepayGateway;