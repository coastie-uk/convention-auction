const DONATION_AMOUNT_SQL = 'COALESCE(donation_amount, 0)';
const SETTLEMENT_AMOUNT_SQL = `(amount - ${DONATION_AMOUNT_SQL})`;

function roundCurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return NaN;
  return Math.round((numeric + Number.EPSILON) * 100) / 100;
}

function getBidderPaymentTotals(db, bidderId, auctionId = null) {
  if (!Number.isInteger(Number(bidderId)) || Number(bidderId) <= 0) {
    return {
      lots_total: 0,
      payments_total: 0,
      donations_total: 0,
      gross_total: 0,
      balance: 0
    };
  }

  const useAuctionFilter = Number.isInteger(Number(auctionId)) && Number(auctionId) > 0;
  const itemSql = useAuctionFilter
    ? `SELECT SUM(hammer_price) FROM items WHERE winning_bidder_id = ? AND auction_id = ? AND COALESCE(is_deleted, 0) = 0`
    : `SELECT SUM(hammer_price) FROM items WHERE winning_bidder_id = ? AND COALESCE(is_deleted, 0) = 0`;
  const params = useAuctionFilter
    ? [Number(bidderId), Number(auctionId), Number(bidderId), Number(bidderId), Number(bidderId)]
    : [Number(bidderId), Number(bidderId), Number(bidderId), Number(bidderId)];

  const row = db.prepare(`
    SELECT
      IFNULL((${itemSql}), 0) AS lots_total,
      IFNULL((SELECT SUM(${SETTLEMENT_AMOUNT_SQL}) FROM payments WHERE bidder_id = ?), 0) AS payments_total,
      IFNULL((SELECT SUM(${DONATION_AMOUNT_SQL}) FROM payments WHERE bidder_id = ?), 0) AS donations_total,
      IFNULL((SELECT SUM(amount) FROM payments WHERE bidder_id = ?), 0) AS gross_total
  `).get(...params) || {};

  const lotsTotal = roundCurrency(row.lots_total || 0) || 0;
  const paymentsTotal = roundCurrency(row.payments_total || 0) || 0;
  const donationsTotal = roundCurrency(row.donations_total || 0) || 0;
  const grossTotal = roundCurrency(row.gross_total || 0) || 0;

  return {
    lots_total: lotsTotal,
    payments_total: paymentsTotal,
    donations_total: donationsTotal,
    gross_total: grossTotal,
    balance: roundCurrency(lotsTotal - paymentsTotal) || 0
  };
}

function calculateDonationRefundAfterSettlement({
  remainingSettlementAmount,
  remainingDonationAmount,
  refundAmount
}) {
  const remainingSettlement = roundCurrency(remainingSettlementAmount) || 0;
  const remainingDonation = roundCurrency(remainingDonationAmount) || 0;
  const refund = roundCurrency(refundAmount) || 0;

  if (!(refund > 0) || !(remainingDonation > 0)) {
    return 0;
  }

  const donationPortion = roundCurrency(refund - remainingSettlement) || 0;
  return Math.max(0, Math.min(donationPortion, remainingDonation, refund));
}

module.exports = {
  DONATION_AMOUNT_SQL,
  SETTLEMENT_AMOUNT_SQL,
  roundCurrency,
  getBidderPaymentTotals,
  calculateDonationRefundAfterSettlement
};
