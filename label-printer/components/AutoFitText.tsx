import React, { useRef, useLayoutEffect, useState, useEffect } from 'react';

interface AutoFitTextProps {
  text: string;
  className?: string;
  width: number;
  height?: number;
  maxFontSize?: number;
  minFontSize?: number;
  fontWeight?: 'normal' | 'bold' | '300' | '400' | '700';
  editable?: boolean;
  onChange?: (val: string) => void;
  placeholder?: string;
  align?: 'left' | 'center' | 'right';
  uppercase?: boolean; 
}

export const AutoFitText: React.FC<AutoFitTextProps> = ({ 
  text, 
  className = "", 
  width,
  height = 100,
  maxFontSize = 100, 
  minFontSize = 12,
  fontWeight = 'bold',
  editable = false,
  onChange,
  placeholder,
  align = 'left',
  uppercase = false
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [fontSize, setFontSize] = useState(minFontSize); 

  const calculateFontSize = (inputStr: string) => {
    const str = uppercase ? (inputStr || '').toUpperCase() : (inputStr || '');
    if (!str) return maxFontSize;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return maxFontSize;

    let low = minFontSize;
    let high = maxFontSize;
    let bestFit = minFontSize;

    // Font weight mapping for Canvas to match CSS
    const weightVal = fontWeight === 'bold' ? '700' : fontWeight === 'normal' ? '400' : fontWeight;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      ctx.font = `${weightVal} ${mid}px "Roboto Condensed"`;
      const textMetrics = ctx.measureText(str);
      
      const textWidth = textMetrics.width;
      
      // HEIGHT CALCULATION:
      // Using 1.15 to ensure safe clearing of descenders and ascenders
      const textHeight = mid * 1.15; 

      if (textWidth <= width && textHeight <= height) {
        bestFit = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return bestFit;
  };

  useLayoutEffect(() => {
    const size = calculateFontSize(text || placeholder || '');
    setFontSize(size);
  }, [text, width, height, maxFontSize, minFontSize, fontWeight, placeholder, uppercase]);

  useEffect(() => {
    document.fonts.ready.then(() => {
      const size = calculateFontSize(text || placeholder || '');
      setFontSize(size);
    });
  }, [text, uppercase]);

  const handleBlur = () => {
    if (ref.current && onChange) {
      const newText = ref.current.innerText;
      if (newText !== text) onChange(newText);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      ref.current?.blur();
    }
  };

  // Update font size while typing to prevent overflow visually
  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const currentText = e.currentTarget.innerText;
    const size = calculateFontSize(currentText);
    if (size !== fontSize) {
        setFontSize(size);
    }
  };

  const handleContainerClick = (e: React.MouseEvent) => {
    // Only focus if the click wasn't on the editable div itself (avoids interfering with browser caret placement)
    if (editable && ref.current && e.target !== ref.current) {
        ref.current.focus();
    }
  };

  useEffect(() => {
    if (editable && ref.current && document.activeElement !== ref.current) {
      ref.current.innerText = uppercase ? (text || '').toUpperCase() : (text || '');
    }
  }, [text, uppercase, editable]);

  const displayedText = uppercase ? (text || '').toUpperCase() : (text || '');

  return (
    <div 
      className={`relative ${className} ${editable ? 'cursor-text hover:bg-gray-50' : ''}`}
      onClick={handleContainerClick}
      style={{
        width: `${width}px`,
        height: height ? `${height}px` : 'auto',
        display: 'flex',
        alignItems: 'center', 
        justifyContent: align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start',
        overflow: 'visible' 
      }}
    >
        <div 
        ref={ref}
        contentEditable={editable}
        suppressContentEditableWarning
        onBlur={handleBlur}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        className=""
        style={{ 
            fontSize: `${fontSize}px`,
            fontFamily: '"Roboto Condensed", sans-serif',
            fontWeight: fontWeight === 'bold' ? 700 : fontWeight === 'normal' ? 400 : parseInt(fontWeight),
            // Use 1.15 line-height to ensure text isn't cut off by container bounds during PDF generation
            lineHeight: '1.15', 
            whiteSpace: 'nowrap',
            outline: 'none',
            textTransform: uppercase ? 'uppercase' : 'none',
            width: '100%',
            textAlign: align,
            display: 'block',
            minHeight: '1.2em' // Ensures the line has height even when empty so the caret is visible
        }} 
        data-placeholder={placeholder}
        >
          {!editable ? displayedText : null}
        </div>
    </div>
  );
};