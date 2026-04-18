'use client';

export default function ButtonCustomizer({ label, color, textColor, position, onChange }) {
  const bg = color || '#1a1a2e';
  const fg = textColor || '#ffffff';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Button label</label>
          <input
            type="text"
            value={label}
            onChange={e => onChange({ label: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            placeholder="Make an offer"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Position</label>
          <select
            value={position || 'below-cart'}
            onChange={e => onChange({ position: e.target.value })}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          >
            <option value="below-cart">Below Add to Cart</option>
            <option value="floating">Floating bubble (bottom right)</option>
            <option value="inline">Inline</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Background color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={bg} onChange={e => onChange({ color: e.target.value })}
              className="w-10 h-10 rounded cursor-pointer border-0" />
            <input type="text" value={bg} onChange={e => onChange({ color: e.target.value })}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Text color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={fg} onChange={e => onChange({ textColor: e.target.value })}
              className="w-10 h-10 rounded cursor-pointer border-0" />
            <input type="text" value={fg} onChange={e => onChange({ textColor: e.target.value })}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500" />
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Preview</label>
        <div className="bg-gray-100 rounded-xl p-6 flex items-center justify-center">
          <button
            style={{ background: 'transparent', border: `1.5px solid ${bg}`, color: bg, padding: '10px 24px', borderRadius: '6px', fontWeight: 500, fontSize: '14px', cursor: 'default' }}
          >
            ✦ {label || 'Make an offer'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1 text-center">Button matches your store's Add to Cart style by default</p>
      </div>
    </div>
  );
}
