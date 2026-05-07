// Editable card the merchant uses to refine an AI-detected product
// before clicking Create All. Title + description are pre-filled by
// the AI, sizes get a default chip set, price + color are merchant
// inputs. Confidence % is read-only.

const COMMON_SIZES = ['XS','S','M','L','XL','2X','One Size'];

export default function ProductReviewCard({ product: p, onChange, onRemove, onToggleSize }) {
  const conf = p.confidence != null ? Math.round(p.confidence * 100) : null;
  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <input
            value={p.title}
            onChange={e => onChange({ title: e.target.value })}
            placeholder="Product title"
            className="w-full text-base font-semibold text-gray-900 bg-transparent border-0 focus:outline-none focus:bg-indigo-50/40 rounded px-1 -mx-1"
          />
          <div className="flex items-center gap-2 mt-1">
            {p.category && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
                {p.category}
              </span>
            )}
            {conf != null && (
              <span className="text-[10px] uppercase tracking-wider font-semibold text-indigo-600">
                {conf}% match
              </span>
            )}
          </div>
        </div>
        <button onClick={onRemove} className="text-gray-400 hover:text-red-600 text-sm w-7 h-7 rounded-full hover:bg-red-50 flex items-center justify-center" title="Remove">×</button>
      </div>

      <textarea
        value={p.description}
        onChange={e => onChange({ description: e.target.value })}
        placeholder="Description"
        rows={2}
        className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-400 resize-none"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 block mb-1">
            Price <span className="text-red-500">*</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={p.price}
              onChange={e => onChange({ price: e.target.value })}
              placeholder="0.00"
              className="w-full border border-gray-200 rounded-lg pl-7 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 block mb-1">
            Color (optional)
          </label>
          <input
            type="text"
            value={p.color}
            onChange={e => onChange({ color: e.target.value })}
            placeholder="e.g. Beige"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          />
        </div>
      </div>

      <div>
        <label className="text-[11px] uppercase tracking-wider font-semibold text-gray-500 block mb-1.5">
          Sizes available
        </label>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_SIZES.map(s => {
            const active = p.sizes.includes(s);
            return (
              <button
                key={s}
                onClick={() => onToggleSize(s)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  active
                    ? 'bg-gray-900 text-white border border-gray-900'
                    : 'bg-white text-gray-700 border border-gray-200 hover:border-gray-400'
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </div>

      {p.tags && p.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {p.tags.map(t => (
            <span key={t} className="text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{t}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export { COMMON_SIZES };
