import React, { useState, useEffect, useMemo } from 'react';
import { useProject } from '../ProjectContext';
import { 
  MdDelete, 
  MdAutoFixHigh, 
  MdCheckCircle, 
  MdWarning, 
  MdSearch, 
  MdClose,
  MdRule,
  MdBlock,
  MdElectricBolt,
  MdAdd,
  MdEdit
} from 'react-icons/md';
import { RarityType, TraitT } from '../WenPadTypes';
import { toast } from 'react-toastify';

// Cache blob URLs by trait ID to avoid recreating object URLs and causing image flickers
const traitBlobUrlCache = new Map<string, string>();

export const getTraitImageUrl = (trait: TraitT) => {
  if (!trait.data) return '';
  if (traitBlobUrlCache.has(trait.id)) {
    return traitBlobUrlCache.get(trait.id)!;
  }
  let blob: Blob;
  if (trait.data instanceof Blob) {
    blob = trait.data;
  } else if (trait.data instanceof ArrayBuffer || ArrayBuffer.isView(trait.data)) {
    blob = new Blob([trait.data as BlobPart], { type: trait.type || 'image/png' });
  } else {
    try {
      blob = new Blob([trait.data as BlobPart], { type: trait.type || 'image/png' });
    } catch {
      return '';
    }
  }
  const url = URL.createObjectURL(blob);
  traitBlobUrlCache.set(trait.id, url);
  return url;
};

// Inline editable trait name component
const EditableTraitName = ({
  initialName,
  onSave,
}: {
  initialName: string;
  onSave: (newName: string) => void;
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(initialName);

  useEffect(() => {
    setName(initialName);
  }, [initialName]);

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== initialName) {
      onSave(trimmed);
    } else {
      setName(initialName);
    }
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 w-full" onClick={(e) => e.stopPropagation()}>
        <input
          type="text"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit();
            if (e.key === 'Escape') {
              setName(initialName);
              setIsEditing(false);
            }
          }}
          onBlur={handleSubmit}
          className="w-full bg-gray-950 border border-primary-orange text-xs text-white font-bold rounded px-1.5 py-0.5 focus:outline-none"
        />
        <button
          type="button"
          onClick={handleSubmit}
          className="text-primary-orange hover:text-white p-0.5 shrink-0"
          title="Save trait name"
        >
          <MdCheckCircle size={15} />
        </button>
      </div>
    );
  }

  return (
    <div 
      className="flex items-center justify-between group/name cursor-pointer py-0.5 hover:bg-gray-700/30 px-1 rounded transition-colors"
      onClick={() => setIsEditing(true)}
      title="Click to rename trait"
    >
      <p className="text-xs font-bold truncate text-gray-200 group-hover/name:text-primary-orange transition-colors">
        {name}
      </p>
      <MdEdit size={12} className="text-gray-500 opacity-0 group-hover/name:opacity-100 hover:text-primary-orange transition-opacity shrink-0 ml-1" />
    </div>
  );
};

// Isolated input so user can backspace, clear, and type decimals without snapping back to 0
const TraitRarityInput = ({
  rarity,
  onChange,
}: {
  rarity: number;
  onChange: (val: number) => void;
}) => {
  const [text, setText] = useState<string>(() => (rarity === 0 ? '0' : rarity.toString()));

  useEffect(() => {
    setText((prev) => {
      const parsed = parseFloat(prev);
      if (!isNaN(parsed) && parsed === rarity) return prev;
      return rarity.toString();
    });
  }, [rarity]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setText(val);
    const parsed = parseFloat(val);
    if (!isNaN(parsed) && parsed >= 0) {
      onChange(parsed);
    }
  };

  const handleBlur = () => {
    const parsed = parseFloat(text);
    if (isNaN(parsed) || parsed < 0) {
      setText('0');
      onChange(0);
    } else {
      setText(parsed.toString());
      onChange(parsed);
    }
  };

  return (
    <input
      type="number"
      step="any"
      min="0"
      value={text}
      onChange={handleChange}
      onBlur={handleBlur}
      className="w-full bg-gray-900 border border-gray-700 rounded-lg px-2 py-1.5 text-xs font-semibold focus:outline-none focus:border-primary-orange text-center text-gray-200"
    />
  );
};

const TraitPreviewGrid = () => {
  const { 
    activeLayerDetails, activeLayerIndex, form, deleteTrait, autofillRarity, 
    resetOriginalProject, layers, addTraitRule, deleteTraitRule, updateTraitName 
  } = useProject();
  const traits = activeLayerDetails?.traits || [];
  const [layerFilter, setLayerFilter] = useState('');

  // Rules Modal state
  const [rulesTrait, setRulesTrait] = useState<TraitT | null>(null);
  const [newRuleType, setNewRuleType] = useState<'block' | 'force'>('block');
  const [targetLayerId, setTargetLayerId] = useState<string>('');
  const [targetTraitId, setTargetTraitId] = useState<string>('');

  const filteredTraits = useMemo(() => {
    if (!layerFilter.trim()) return traits;
    const q = layerFilter.trim().toLowerCase();
    return traits.filter(t => t.name.toLowerCase().includes(q));
  }, [traits, layerFilter]);

  const otherLayers = useMemo(() => {
    if (!activeLayerDetails) return [];
    return (layers || []).filter(l => l.id !== activeLayerDetails.id);
  }, [layers, activeLayerDetails]);

  // Open rules modal
  const handleOpenRulesModal = (trait: TraitT) => {
    setRulesTrait(trait);
    setNewRuleType('block');
    const firstOther = otherLayers[0];
    setTargetLayerId(firstOther?.id || '');
    setTargetTraitId('*'); // Default to blocking entire category for convenience
  };

  const handleAddRuleSubmit = () => {
    if (!rulesTrait || !activeLayerDetails) return;
    if (!targetLayerId) {
      toast.error('Please select target layer');
      return;
    }

    const isCategoryBlock = newRuleType === 'block' && (targetTraitId === '*' || !targetTraitId);
    if (!isCategoryBlock && !targetTraitId) {
      toast.error('Please select target trait');
      return;
    }

    addTraitRule(activeLayerDetails.id, rulesTrait.id, {
      type: isCategoryBlock ? 'block_layer' : newRuleType,
      layer: targetLayerId,
      trait: isCategoryBlock ? '*' : targetTraitId,
    });

    // Update modal view
    const updatedTargetL = form.getValues('layers').find(l => l.id === activeLayerDetails.id);
    const updatedT = updatedTargetL?.traits.find(t => t.id === rulesTrait.id);
    if (updatedT) {
      setRulesTrait(updatedT);
    }
  };

  const handleDeleteRuleSubmit = (idx: number) => {
    if (!rulesTrait || !activeLayerDetails) return;
    deleteTraitRule(activeLayerDetails.id, rulesTrait.id, idx);
    const updatedTargetL = form.getValues('layers').find(l => l.id === activeLayerDetails.id);
    const updatedT = updatedTargetL?.traits.find(t => t.id === rulesTrait.id);
    if (updatedT) {
      setRulesTrait(updatedT);
    }
  };

  const handleRarityChange = (traitIndex: number, newRarity: number) => {
    const currentLayers = form.getValues('layers');
    const updatedLayers = currentLayers.map((layer, lIdx) => {
      if (lIdx !== activeLayerIndex) return layer;
      return {
        ...layer,
        traits: layer.traits.map((t, tIdx) => {
          if (tIdx !== traitIndex) return t;
          return { ...t, rarity: newRarity };
        }),
      };
    });
    form.setValue('layers', updatedLayers, { shouldDirty: true });
    resetOriginalProject();
  };

  const handleRarityTypeToggle = (traitIndex: number) => {
    const currentLayers = form.getValues('layers');
    const updatedLayers = currentLayers.map((layer, lIdx) => {
      if (lIdx !== activeLayerIndex) return layer;
      return {
        ...layer,
        traits: layer.traits.map((t, tIdx) => {
          if (tIdx !== traitIndex) return t;
          const nextType = t.rarityType === RarityType.PERCENT ? RarityType.NUMBER : RarityType.PERCENT;
          return { ...t, rarityType: nextType };
        }),
      };
    });
    form.setValue('layers', updatedLayers, { shouldDirty: true });
    resetOriginalProject();
  };

  const handleSetAllRarityType = (type: RarityType) => {
    const currentLayers = form.getValues('layers');
    const updatedLayers = currentLayers.map((layer, lIdx) => {
      if (lIdx !== activeLayerIndex) return layer;
      return {
        ...layer,
        traits: layer.traits.map((t) => ({ ...t, rarityType: type })),
      };
    });
    form.setValue('layers', updatedLayers, { shouldDirty: true });
    resetOriginalProject();
  };

  // Compute total percentage if traits use PERCENT
  const { totalPercent, isAllPercent } = useMemo(() => {
    const percentTraits = traits.filter((t) => t.rarityType === RarityType.PERCENT);
    const sum = percentTraits.reduce((acc, t) => acc + (t.rarity || 0), 0);
    return {
      totalPercent: Math.round(sum * 100) / 100,
      isAllPercent: percentTraits.length === traits.length && traits.length > 0,
    };
  }, [traits]);

  const isExact100 = Math.abs(totalPercent - 100) < 0.05;

  return (
    <div className="space-y-4">
      {/* Layer Stats & Quick Actions Toolbar */}
      <div className="flex flex-wrap justify-between items-center bg-[#010002]/40 p-4 rounded-2xl border border-gray-800/80 gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-black uppercase tracking-widest text-gray-400">
            {traits.length} {traits.length === 1 ? 'Trait' : 'Traits'}
          </span>

          {isAllPercent && (
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
              isExact100 
                ? 'bg-green-500/15 text-green-400 border-green-500/30' 
                : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
            }`}>
              {isExact100 ? <MdCheckCircle size={14} /> : <MdWarning size={14} />}
              <span>
                Total: {totalPercent}%
                {!isExact100 && (
                  totalPercent < 100 
                    ? ` (needs +${(100 - totalPercent).toFixed(1)}%)`
                    : ` (exceeds by +${(totalPercent - 100).toFixed(1)}%)`
                )}
              </span>
            </div>
          )}

          {/* In-layer search input */}
          {traits.length > 3 && (
            <div className="relative w-36 sm:w-44">
              <MdSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" size={14} />
              <input
                value={layerFilter}
                onChange={(e) => setLayerFilter(e.target.value)}
                placeholder="Filter traits..."
                className="w-full bg-gray-900 border border-gray-700/80 rounded-xl pl-7 pr-6 py-1 text-xs focus:outline-none focus:border-primary-orange text-gray-200 placeholder:text-gray-600"
              />
              {layerFilter && (
                <button 
                  type="button"
                  onClick={() => setLayerFilter('')} 
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <MdClose size={12} />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick toggle all units */}
          <div className="flex items-center bg-gray-900 border border-gray-700/80 rounded-xl p-0.5 text-[10px] font-bold">
            <button
              type="button"
              onClick={() => handleSetAllRarityType(RarityType.PERCENT)}
              className="px-2.5 py-1 rounded-lg hover:text-white transition-colors text-gray-400 hover:bg-gray-800"
            >
              All %
            </button>
            <button
              type="button"
              onClick={() => handleSetAllRarityType(RarityType.NUMBER)}
              className="px-2.5 py-1 rounded-lg hover:text-white transition-colors text-gray-400 hover:bg-gray-800"
            >
              All Qty
            </button>
          </div>

          <button 
            type="button"
            onClick={() => autofillRarity(activeLayerIndex)}
            className="text-[10px] flex items-center gap-1.5 bg-primary-orange/10 text-primary-orange px-4 py-2 rounded-xl border border-primary-orange/20 hover:bg-primary-orange/20 transition-all font-black uppercase tracking-widest"
          >
            <MdAutoFixHigh size={14} /> Autofill Rarity (100%)
          </button>
        </div>
      </div>

      {/* Grid of Traits */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-4">
        {filteredTraits.map((trait) => {
          const originalIndex = traits.findIndex(t => t.id === trait.id);
          return (
            <div 
              key={trait.id} 
              className="bg-gray-800/90 rounded-2xl border border-gray-700 overflow-hidden group hover:border-primary-orange/50 transition-all flex flex-col justify-between"
            >
              <div className="aspect-square bg-gray-900/80 relative flex items-center justify-center p-2">
                <img 
                  src={getTraitImageUrl(trait)} 
                  alt={trait.name} 
                  className="w-full h-full object-contain"
                  loading="lazy"
                />
                <button 
                  type="button"
                  onClick={() => deleteTrait(activeLayerDetails!, trait)}
                  className="absolute top-2 right-2 p-1.5 bg-red-500/80 hover:bg-red-600 text-white rounded-lg opacity-0 group-hover:opacity-100 transition-opacity shadow-lg"
                  title="Delete trait"
                >
                  <MdDelete size={14} />
                </button>
              </div>

              <div className="p-3 space-y-2 bg-gray-800">
                <EditableTraitName
                  initialName={trait.name}
                  onSave={(newName) => updateTraitName(activeLayerDetails!.id, trait.id, newName)}
                />

                <div className="flex items-center gap-1.5">
                  <div className="flex-1">
                    <TraitRarityInput
                      rarity={trait.rarity}
                      onChange={(val) => handleRarityChange(originalIndex, val)}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRarityTypeToggle(originalIndex)}
                    className={`px-2 py-1.5 rounded-lg text-[10px] font-black uppercase transition-all border ${
                      trait.rarityType === RarityType.PERCENT
                        ? 'bg-primary-orange/20 text-primary-orange border-primary-orange/40 hover:bg-primary-orange/30'
                        : 'bg-blue-500/20 text-blue-400 border-blue-500/40 hover:bg-blue-500/30'
                    }`}
                    title="Click to switch between % and Qty"
                  >
                    {trait.rarityType === RarityType.PERCENT ? '%' : 'Qty'}
                  </button>
                </div>

                {/* Trait Rules Button */}
                <button
                  type="button"
                  onClick={() => handleOpenRulesModal(trait)}
                  className={`w-full py-1.5 px-2 rounded-lg text-[10px] font-bold transition-all border flex items-center justify-center gap-1.5 cursor-pointer ${
                    (trait.rules?.length || 0) > 0
                      ? 'bg-primary-orange/20 text-primary-orange border-primary-orange/40 hover:bg-primary-orange/30'
                      : 'bg-gray-700/40 text-gray-400 border-gray-700 hover:text-white hover:bg-gray-700'
                  }`}
                  title="Configure compatibility rules"
                >
                  <MdRule size={13} />
                  {(trait.rules?.length || 0) > 0 ? `Rules (${trait.rules?.length})` : 'Add Rules'}
                </button>
              </div>
            </div>
          );
        })}

        {traits.length > 0 && filteredTraits.length === 0 && (
          <div className="col-span-full py-12 flex flex-col items-center justify-center text-gray-500 bg-gray-900/20 rounded-2xl border border-gray-800">
            <p className="text-sm">No traits matching "{layerFilter}"</p>
            <button 
              onClick={() => setLayerFilter('')} 
              className="mt-2 text-xs text-primary-orange hover:underline font-bold"
            >
              Clear filter
            </button>
          </div>
        )}
      </div>

      {/* Trait Rules Management Modal */}
      {rulesTrait && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 animate-in fade-in duration-200"
          onClick={() => setRulesTrait(null)}
        >
          <div 
            className="bg-[#1A171A] border border-gray-700 rounded-3xl max-w-lg w-full p-6 space-y-5 shadow-2xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center pb-3 border-b border-gray-800">
              <div>
                <h3 className="text-base font-black text-gray-100 flex items-center gap-2">
                  <MdRule size={18} className="text-primary-orange" />
                  Rules for <span className="text-primary-orange">{rulesTrait.name}</span>
                </h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Layer: {activeLayerDetails?.name}
                </p>
              </div>
              <button 
                type="button"
                onClick={() => setRulesTrait(null)}
                className="p-1.5 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
              >
                <MdClose size={18} />
              </button>
            </div>

            {/* Existing Rules List */}
            <div className="space-y-2">
              <h5 className="text-[10px] font-black uppercase tracking-wider text-gray-400">
                Active Rules ({rulesTrait.rules?.length || 0})
              </h5>

              {(rulesTrait.rules?.length || 0) === 0 ? (
                <div className="p-3 text-center text-xs text-gray-500 bg-gray-900/40 rounded-xl border border-gray-800">
                  No rules set for this trait yet.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                  {rulesTrait.rules?.map((rule, rIdx) => {
                    const targetL = layers.find(l => l.id === rule.layer || l.name === rule.layer);
                    const targetT = targetL?.traits.find(t => t.id === rule.trait || t.name === rule.trait);
                    const isCategoryBlock = rule.type === 'block_layer' || rule.trait === '*' || rule.trait === 'ALL';

                    return (
                      <div 
                        key={rIdx}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-gray-900 border border-gray-800 text-xs"
                      >
                        <div className="flex items-center gap-2 text-gray-300">
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded uppercase ${
                            isCategoryBlock
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : rule.type === 'block' 
                                ? 'bg-red-500/20 text-red-400' 
                                : 'bg-blue-500/20 text-blue-400'
                          }`}>
                            {isCategoryBlock ? 'Block Category' : rule.type === 'block' ? 'Never' : 'Always'}
                          </span>
                          <span>
                            {isCategoryBlock ? (
                              <>
                                Never with Entire Category:{' '}
                                <strong className="text-red-400 font-bold">{targetL?.name || rule.layer}</strong>
                              </>
                            ) : (
                              <>
                                {rule.type === 'block' ? 'Never with' : 'Always with'}{' '}
                                <strong className="text-primary-orange">{targetT?.name || rule.trait}</strong>{' '}
                                <span className="text-gray-500">({targetL?.name || rule.layer})</span>
                              </>
                            )}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteRuleSubmit(rIdx)}
                          className="p-1 text-gray-500 hover:text-red-400 transition-colors cursor-pointer"
                          title="Delete rule"
                        >
                          <MdDelete size={16} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Add New Rule Card */}
            {otherLayers.length > 0 ? (
              <div className="p-4 bg-gray-900/90 border border-gray-800 rounded-2xl space-y-3">
                <h5 className="text-[10px] font-black uppercase tracking-wider text-primary-orange flex items-center gap-1.5">
                  <MdAdd size={14} /> Add New Rule
                </h5>

                <div className="grid grid-cols-2 gap-2 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => {
                      setNewRuleType('block');
                      if (!targetTraitId) setTargetTraitId('*');
                    }}
                    className={`py-1.5 px-2 rounded-xl border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      newRuleType === 'block'
                        ? 'bg-red-500/20 text-red-300 border-red-500/60'
                        : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                    }`}
                  >
                    <MdBlock size={14} /> Never Use With
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNewRuleType('force');
                      const targetL = otherLayers.find(l => l.id === targetLayerId);
                      setTargetTraitId(targetL?.traits[0]?.id || '');
                    }}
                    className={`py-1.5 px-2 rounded-xl border flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                      newRuleType === 'force'
                        ? 'bg-blue-500/20 text-blue-300 border-blue-500/60'
                        : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'
                    }`}
                  >
                    <MdElectricBolt size={14} /> Always Use With
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-semibold text-gray-400 block mb-1">Target Layer (Category)</label>
                    <select
                      value={targetLayerId}
                      onChange={(e) => {
                        const newLayerId = e.target.value;
                        const targetL = otherLayers.find(l => l.id === newLayerId);
                        setTargetLayerId(newLayerId);
                        setTargetTraitId(newRuleType === 'block' ? '*' : (targetL?.traits[0]?.id || ''));
                      }}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-primary-orange"
                    >
                      {otherLayers.map(l => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-gray-400 block mb-1">Target Trait</label>
                    <select
                      value={targetTraitId}
                      onChange={(e) => setTargetTraitId(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-xl px-2.5 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-primary-orange"
                    >
                      {newRuleType === 'block' && (
                        <option value="*">⛔ Entire Category (All traits)</option>
                      )}
                      {otherLayers
                        .find(l => l.id === targetLayerId)
                        ?.traits.map(t => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleAddRuleSubmit}
                  className="w-full py-2 bg-primary-orange hover:bg-primary-orange/80 text-black font-black text-xs uppercase tracking-wider rounded-xl transition-all shadow-md cursor-pointer"
                >
                  Save Rule
                </button>
              </div>
            ) : (
              <p className="text-xs text-gray-500 italic">
                Add at least one more layer to configure trait rules.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TraitPreviewGrid;
