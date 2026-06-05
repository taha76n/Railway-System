import SafepayGateway from "./safepay.gateway.js";
const { config } = require("../../configs/index.js");


let gatewayInstance = null;

/**
 * Factory function to create/get a payment gateway instance.
 * Uses singleton pattern — one gateway instance per process.
 * To add a new gateway (e.g., Stripe):
 *   1. Create stripe.gateway.js extending BaseGateway
 *   2. Add a case here
 *   3. Set PAYMENT_GATEWAY=stripe in .env
 */
function getGateway() {
     if (gatewayInstance) return gatewayInstance;

     const provider = config.PAYMENT_GATEWAY;

     switch (provider) {
          case 'safepay':
               gatewayInstance = new SafepayGateway(
                    config.SAFEPAY_KEY_SECRET,
                    config.SAFEPAY_WEBHOOK_SECRET
               );
               break;

          // Future gateways:
          // case 'stripe':
          //      gatewayInstance = new StripeGateway(config.STRIPE_KEY, ...);
          //      break;

          default:
               throw new Error(`Unknown payment gateway provider: ${provider}`);
     }

     return gatewayInstance;
}

export default getGateway;
