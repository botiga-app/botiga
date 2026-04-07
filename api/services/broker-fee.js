function calculateBrokerFee({ listPrice, floorPrice, dealPrice, brokerFeePct }) {
  const spread = dealPrice - floorPrice;
  const brokerFee = spread * (brokerFeePct / 100);
  const merchantReceives = dealPrice - brokerFee;

  return {
    listPrice,
    floorPrice,
    dealPrice,
    spread: Math.round(spread * 100) / 100,
    brokerFeePct,
    brokerFee: Math.round(brokerFee * 100) / 100,
    merchantReceives: Math.round(merchantReceives * 100) / 100
  };
}

module.exports = { calculateBrokerFee };
