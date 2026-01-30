'use client';

interface HardwareCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function HardwareCheckbox({ checked, onChange, disabled = true }: HardwareCheckboxProps) {
  return (
    <div
      className={`
        relative rounded-xl p-5 border transition-all duration-200
        ${disabled
          ? 'bg-white/5 border-white/10 opacity-60 cursor-not-allowed'
          : checked
            ? 'bg-gradient-to-r from-purple-500/10 to-blue-500/10 border-purple-500/50'
            : 'bg-white/5 border-white/10 hover:border-white/20 cursor-pointer'
        }
      `}
      onClick={() => !disabled && onChange(!checked)}
    >
      <div className="flex items-start gap-4">
        {/* Checkbox */}
        <div
          className={`
            w-6 h-6 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5
            transition-all duration-200
            ${disabled
              ? 'border-white/20 bg-white/5'
              : checked
                ? 'border-purple-500 bg-purple-500'
                : 'border-white/30 hover:border-white/50'
            }
          `}
        >
          {checked && (
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>

        {/* Content */}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h4 className={`font-semibold ${disabled ? 'text-white/50' : 'text-white'}`}>
              Local Zenna Brain
            </h4>
            <span className="px-2 py-0.5 text-xs font-medium bg-gradient-to-r from-purple-500 to-blue-500 text-white rounded-full">
              Add-on
            </span>
            {disabled && (
              <span className="px-2 py-0.5 text-xs font-medium bg-white/10 text-white/50 rounded-full">
                Coming Soon
              </span>
            )}
          </div>
          <p className={`text-sm ${disabled ? 'text-white/30' : 'text-white/60'}`}>
            Hardware bundle for privacy-first local processing with encrypted cloud backups (user-held keys only)
          </p>
          <p className={`text-lg font-bold mt-2 ${disabled ? 'text-white/40' : 'text-white'}`}>
            $499 <span className="text-sm font-normal text-white/50">one-time</span>
          </p>
        </div>

        {/* Hardware Icon */}
        <div className={`p-3 rounded-lg ${disabled ? 'bg-white/5' : 'bg-purple-500/10'}`}>
          <svg
            className={`w-8 h-8 ${disabled ? 'text-white/30' : 'text-purple-400'}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}
