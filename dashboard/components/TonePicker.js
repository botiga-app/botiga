'use client';

const TONES = [
  {
    id: 'friendly',
    label: 'Friendly',
    emoji: '😊',
    desc: 'Warm and encouraging. Customers feel welcomed.',
    preview: "Hey! I love your taste. This is already 25% off but I can do $79 with free shipping — that's my best offer!"
  },
  {
    id: 'sassy',
    label: 'Sassy',
    emoji: '😏',
    desc: 'Witty and playful. Makes negotiation fun.',
    preview: "Nice try! But $70 would have my boss calling me at 2am. How about $79? Still a steal."
  },
  {
    id: 'desi',
    label: 'Desi',
    emoji: '🙏',
    desc: 'Warm like a bazaar shopkeeper. Feels familiar.',
    preview: "Acha yaar, I hear you! Come on now, for you I'll do $79. Like family price, bhai."
  },
  {
    id: 'professional',
    label: 'Professional',
    emoji: '💼',
    desc: 'Polished and formal. Great for luxury goods.',
    preview: "Thank you for your inquiry. I'm able to offer $79, which represents our best available price for this item."
  },
  {
    id: 'urgent',
    label: 'Urgent',
    emoji: '⏰',
    desc: 'Creates time pressure. Motivates quick decisions.',
    preview: "Two others are looking at this right now! I can lock in $79 for the next 15 minutes — want me to hold it?"
  },
  {
    id: 'generous',
    label: 'Generous',
    emoji: '🎁',
    desc: 'Moves fast toward your price. Good for clearing stock.',
    preview: "You drive a hard bargain! Okay, $74 and I'll throw in free shipping. Deal?"
  }
];

export default function TonePicker({ value, onChange }) {
  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {TONES.map(tone => (
          <button
            key={tone.id}
            type="button"
            onClick={() => onChange(tone.id)}
            className={`text-left p-4 rounded-xl border-2 transition-all ${
              value === tone.id
                ? 'border-indigo-500 bg-indigo-50'
                : 'border-gray-100 bg-white hover:border-gray-200'
            }`}
          >
            <div className="text-2xl mb-1">{tone.emoji}</div>
            <div className="font-semibold text-sm text-gray-900">{tone.label}</div>
            <div className="text-xs text-gray-500 mt-0.5">{tone.desc}</div>
          </button>
        ))}
      </div>
      {value && (
        <div className="mt-4 bg-gray-50 rounded-xl p-4">
          <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">Preview response to "Can you do $70?"</p>
          <p className="text-sm text-gray-700 italic">"{TONES.find(t => t.id === value)?.preview}"</p>
        </div>
      )}
    </div>
  );
}
