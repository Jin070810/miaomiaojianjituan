import type { RedemptionOrder } from "@prisma/client";

export function memberOrderDto<T extends RedemptionOrder>(row: T) {
  const { recipientPhoneEnc, recipientAddressEnc, cashQrCodeUrl, fulfillmentDataEnc, ...order } = row;
  return {
    ...order,
    fulfilledAt: order.fulfilledAt ?? (order.status === "FULFILLED" ? order.reviewedAt : null),
    hasRecipientPhone: Boolean(recipientPhoneEnc),
    hasRecipientAddress: Boolean(recipientAddressEnc),
    hasCashQrCode: Boolean(cashQrCodeUrl),
    hasFulfillmentData: Boolean(fulfillmentDataEnc),
  };
}
