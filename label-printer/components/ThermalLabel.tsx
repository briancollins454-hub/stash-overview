import React from 'react';
import { Box, Job } from '../types';
import { AutoFitText } from './AutoFitText';

export interface LabelSettings {
  logo1Url: string;
  logo2Url: string;
  logo1Width: number;
  logo2Width: number;
  webhookUrl?: string;
}

interface ThermalLabelProps {
  id?: string;
  className?: string;
  job: Job;
  box: Box;
  totalBoxes: number;
  boxNumber: number;
  settings: LabelSettings;
  printing?: boolean;
  onUpdateJob?: (field: keyof Job, value: string) => void;
  onUpdateBoxItem?: (itemIndex: number, newText: string) => void;
  onUpdateBoxDetail?: (field: keyof Box, value: string) => void;
}

export const ThermalLabel: React.FC<ThermalLabelProps> = ({ 
  id,
  className = '',
  job, 
  box, 
  totalBoxes, 
  boxNumber, 
  settings,
  printing = false,
  onUpdateJob,
  onUpdateBoxItem,
  onUpdateBoxDetail
}) => {
  const maxRows = 10;
  const displayRows = [...box.items];
  
  while (displayRows.length < maxRows) {
    displayRows.push({ id: `temp-${displayRows.length}`, description: '', quantity: 0 });
  }

  const formatTimestamp = (isoStr: string) => {
    try {
        const d = new Date(isoStr);
        if (isNaN(d.getTime())) return '';
        const day = d.getDate().toString().padStart(2, '0');
        const month = (d.getMonth() + 1).toString().padStart(2, '0');
        const year = d.getFullYear().toString().slice(-2);
        const hours = d.getHours().toString().padStart(2, '0');
        const mins = d.getMinutes().toString().padStart(2, '0');
        return `${day}/${month}/${year} ${hours}:${mins}`;
    } catch (e) {
        return '';
    }
  };

  const formatCrypticDate = (isoStr: string, seed: string) => {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      if (isNaN(d.getTime())) return '';

      const day = d.getDate().toString().padStart(2, '0');
      const month = (d.getMonth() + 1).toString().padStart(2, '0');
      
      let hash = 0;
      const str = isoStr + seed;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      
      const rand = (min: number, max: number, salt: number) => {
        const x = Math.sin(hash + salt) * 10000;
        return Math.floor((x - Math.floor(x)) * (max - min)) + min;
      };

      const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
      const r1 = letters[rand(0, 26, 1)];
      const r2 = letters[rand(0, 26, 2)];
      const r3 = letters[rand(0, 26, 3)];
      
      const n1 = rand(0, 10, 4);
      const n2 = rand(0, 10, 5);

      return `${day}${r1}${r2}${r3}${month}-${n1}${n2}X`;
    } catch (e) {
      return '';
    }
  };

  const packedDate = box.packedAt ? formatTimestamp(box.packedAt) : '';
  const crypticDate = formatCrypticDate(job.dateScheduled || '', job.jobNumber);
  const boxCountText = box.customLabel ? box.customLabel : `${boxNumber} OF ${totalBoxes}`;

  const LABEL_WIDTH_PX = 384;
  const LABEL_HEIGHT_PX = 576;
  const PADDING_X = 16; 

  const baseClasses = `bg-white text-black relative flex flex-col font-roboto-condensed ${className}`;
  const displayClasses = printing ? '' : 'border border-gray-300 shadow-lg';
  
  const Separator = () => <div className="w-full h-[5px] bg-black shrink-0"></div>;

  return (
    <div 
      id={id}
      className={`${baseClasses} ${displayClasses}`}
      style={{ 
        width: `${LABEL_WIDTH_PX}px`, 
        height: `${LABEL_HEIGHT_PX}px`, 
        boxSizing: 'border-box',
        padding: '0',
        overflow: 'visible' 
      }}
    >
      {/* --- HEADER (70px) --- */}
      <div 
        className="w-full shrink-0 flex flex-col"
        style={{ height: '70px' }}
      >
          <Separator />
          
          <div className="w-full px-2 flex-grow flex justify-center items-center">
            <AutoFitText 
                key="cust-name"
                text={job.customerName} 
                className=""
                width={LABEL_WIDTH_PX - 12}
                height={45} 
                maxFontSize={38}
                minFontSize={16}
                fontWeight="bold"
                editable={!printing}
                align="center"
                placeholder="CUSTOMER NAME"
                uppercase={true} 
                onChange={(val) => onUpdateJob && onUpdateJob('customerName', val)}
            />
          </div>
          
          <Separator />
      </div>

      {/* --- JOB DETAILS (95px) --- */}
      {/* Reduced height to pull content up */}
      <div 
        className="w-full shrink-0 flex flex-col relative"
        style={{ height: '95px' }} 
      >
        <div className="flex-grow flex flex-col justify-start items-center w-full relative">
            {/* Job Name - Added z-10 and relative to ensure it sits on top of Job Number */}
            <div className="w-full px-4 h-[18px] flex justify-center items-end pb-0 relative z-10">
                <AutoFitText 
                    key="job-name"
                    text={job.jobName} 
                    className=""
                    width={LABEL_WIDTH_PX - (PADDING_X * 2)}
                    height={18}
                    maxFontSize={20}
                    minFontSize={12} 
                    fontWeight="normal"
                    editable={!printing}
                    align="center"
                    placeholder="JOB NAME"
                    uppercase={true}
                    onChange={(val) => onUpdateJob && onUpdateJob('jobName', val)}
                />
            </div>
            {/* Job Number - Moved up significantly (~0.5cm) */}
            <div className="w-full px-4 h-[77px] flex justify-center items-start pt-0 -mt-6 relative z-0">
                <AutoFitText
                    key="job-num"
                    text={job.jobNumber}
                    className="tracking-tight"
                    width={LABEL_WIDTH_PX - (PADDING_X * 2)}
                    height={75} 
                    maxFontSize={95}
                    minFontSize={40}
                    fontWeight="bold"
                    editable={!printing}
                    align="center"
                    placeholder="123456"
                    uppercase={true} 
                    onChange={(val) => onUpdateJob && onUpdateJob('jobNumber', val)}
                />
            </div>
        </div>
        
        <Separator />
      </div>

      {/* --- BOX SUMMARY --- */}
      <div className="flex-grow flex flex-col w-full px-4 pt-0 overflow-hidden relative z-10">
        {/* Title - Increased bottom padding to 2 (approx 0.2cm/8px) to push line down from text */}
        <h2 className="text-lg font-bold text-black uppercase w-full mb-0 leading-none shrink-0 border-b-[5px] border-black pb-2">
          BOX SUMMARY
        </h2>
        
        <div className="flex flex-col flex-grow justify-start gap-[1px]">
          {displayRows.map((item, idx) => (
            <div key={`row-${idx}`} className="h-[21px] w-full relative z-10">
              <AutoFitText 
                text={item.description} 
                className=""
                width={LABEL_WIDTH_PX - (PADDING_X * 2)}
                height={21}
                maxFontSize={18}
                minFontSize={10}
                fontWeight="bold"
                editable={!printing}
                placeholder=""
                uppercase={true}
                onChange={(val) => onUpdateBoxItem && onUpdateBoxItem(idx, val)}
              />
            </div>
          ))}
        </div>
      </div>

      {/* --- CONTROLS SECTION --- */}
      {/* Changed items-start to items-center and added pt-2 to move boxes DOWN */}
      <div className="h-[42px] px-6 flex items-center pt-2 justify-between w-full shrink-0">
          <div className="flex items-center space-x-6">
            {/* PRINT CHECKBOX - Removed border */}
            <div className="flex items-center cursor-pointer" onClick={() => !printing && onUpdateBoxDetail && onUpdateBoxDetail('isPrint', 'toggle')}>
              {/* Added pt-1 to text to better align visually with the square box */}
              <span className="text-xl mr-2 uppercase font-bold leading-none pt-1">PRINT:</span>
              <div className="w-7 h-7 flex items-center justify-center relative">
                {box.isPrint && <div className="absolute inset-0 flex items-center justify-center text-3xl font-bold pb-2">X</div>}
              </div>
            </div>
            {/* EMB CHECKBOX - Removed border */}
            <div className="flex items-center cursor-pointer" onClick={() => !printing && onUpdateBoxDetail && onUpdateBoxDetail('isEmb', 'toggle')}>
               {/* Added pt-1 to text to better align visually with the square box */}
              <span className="text-xl mr-2 uppercase font-bold leading-none pt-1">EMB:</span>
              <div className="w-7 h-7 flex items-center justify-center relative">
                {box.isEmb && <div className="absolute inset-0 flex items-center justify-center text-3xl font-bold pb-2">X</div>}
              </div>
            </div>
          </div>

          {/* BOXED BY */}
          <div className="flex items-center">
                <span className="text-xs mr-2 uppercase font-bold whitespace-nowrap leading-none mt-1">BOXED BY:</span>
                {/* Removed border-b-2 border-black from this div */}
                <div className="w-[60px] h-[26px] flex justify-center items-center pb-0 ml-1">
                    <AutoFitText
                        key="packer-name"
                        text={box.packerName || ''}
                        className=""
                        width={60}
                        height={24}
                        maxFontSize={20}
                        minFontSize={12}
                        fontWeight="bold"
                        editable={!printing}
                        align="center"
                        placeholder=""
                        uppercase={true}
                        onChange={(val) => onUpdateBoxDetail && onUpdateBoxDetail('packerName', val)}
                    />
                </div>
          </div>
      </div>
      
      {/* Separator Line */}
      <div className="w-full px-0">
         <Separator />
      </div>

      {/* --- FOOTER --- */}
      <div className="h-[75px] flex justify-between items-center px-6 py-2 relative w-full shrink-0">
          {/* Box Count & Date */}
          <div className="flex flex-col h-full justify-center">
             <div className="h-[32px] w-[120px]">
                <AutoFitText
                    key={`count-${boxNumber}`}
                    text={boxCountText}
                    className="tracking-tighter"
                    width={120}
                    height={32}
                    maxFontSize={32}
                    minFontSize={20}
                    fontWeight="bold"
                    align="left"
                    uppercase={true}
                    editable={!printing}
                    onChange={(val) => onUpdateBoxDetail && onUpdateBoxDetail('customLabel', val)}
                />
             </div>
             {/* Cryptic Date & Timestamp */}
             <div className="flex flex-col justify-start">
                {crypticDate && (
                  <div className="text-xs font-bold text-black leading-none mt-0.5">
                    {crypticDate}
                  </div>
                )}
                <div className="text-[10px] font-bold text-black leading-none mt-0.5">
                    {packedDate}
                </div>
             </div>
          </div>

          {/* Logos */}
          <div className="flex items-center justify-end space-x-2 h-full">
              {settings.logo1Url ? (
              <img 
                  src={settings.logo1Url} 
                  alt="Logo 1"
                  crossOrigin="anonymous"
                  style={{ width: `${settings.logo1Width}px`, height: 'auto', maxHeight: '55px', objectFit: 'contain' }} 
              />
              ) : null}

              {settings.logo2Url ? (
              <img 
                  src={settings.logo2Url} 
                  alt="Logo 2"
                  crossOrigin="anonymous"
                  style={{ width: `${settings.logo2Width}px`, height: 'auto', maxHeight: '55px', objectFit: 'contain' }}
              />
              ) : null}
          </div>
      </div>

    </div>
  );
};