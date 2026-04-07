'use client';

export default function BrokerFeeBreakdown({ listPrice, floorPrice, brokerFeePct = 25 }) {
  // Example: bot closes at midpoint between floor and list
  const exampleDeal = floorPrice
    ? Math.round((parseFloat(floorPrice) + parseFloat(listPrice)) / 2 * 100) / 100
    : listPrice * 0.9;

  const spread = exampleDeal - (floorPrice || listPrice * 0.8);
  const brokerFee = spread * (brokerFeePct / 100);
  const merchantReceives = exampleDeal - brokerFee;

  if (!listPrice || !floorPrice) {
    return (
      <p className="text-sm text-gray-400">Set list price and floor price above to see the fee calculation.</p>
    );
  }

  return (
    <div className="bg-indigo-50 rounded-xl p-4 text-sm">
      <p className="font-medium text-gray-700 mb-3">Fee example</p>
      <div className="space-y-1.5 text-gray-600">
        <div className="flex justify-between">
          <span>List price</span>
          <span className="font-medium">${parseFloat(listPrice).toFixed(2)}</span>
        </div>
        <div className="flex justify-between">
          <span>Your floor price</span>
          <span className="font-medium">${parseFloat(floorPrice).toFixed(2)}</span>
        </div>
        <div className="flex justify-between text-indigo-700">
          <span>Example deal price (midpoint)</span>
          <span className="font-medium">${exampleDeal.toFixed(2)}</span>
        </div>
        <div className="border-t border-indigo-200 pt-1.5 mt-1.5">
          <div className="flex justify-between">
            <span>Spread (deal − floor)</span>
            <span>${Math.max(0, spread).toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-orange-600">
            <span>Botiga fee ({brokerFeePct}% of spread)</span>
            <span>−${Math.max(0, brokerFee).toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-semibold text-green-700 mt-1">
            <span>You receive</span>
            <span>${Math.max(0, merchantReceives).toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
