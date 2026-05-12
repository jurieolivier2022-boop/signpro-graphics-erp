import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Calculator, AlertCircle, Package as PackageIcon, Book, Layers, Box, Download, Printer, Mail, MessageCircle, Briefcase } from 'lucide-react';
import { Quote, QuoteItem, Client, Product, PricingSettings, Material, Machine, NCRBook, Package, CompanySettings, Job } from '../types';
import { createDocument, updateDocument, useCollection, getNextSequence } from '../lib/firestoreService';
import { calculateQuoteTotals, DEFAULT_PRICING_SETTINGS } from '../lib/pricingService';
import { cn, sqMmToSqM } from '../lib/utils';
import { generateQuotePDF } from '../lib/pdfService';
import { shareViaWhatsApp, shareViaEmail } from '../lib/messagingService';

interface QuoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  quote?: Quote | null;
  prefilledItem?: { type: string; originId: string; quantity: number } | null;
}

export default function QuoteModal({ isOpen, onClose, quote, prefilledItem }: QuoteModalProps) {
  const { data: clients } = useCollection<Client>('clients');
  const { data: products } = useCollection<Product>('products');
  const { data: materials } = useCollection<Material>('materials');
  const { data: machines } = useCollection<Machine>('machines');
  const { data: ncrBooks } = useCollection<NCRBook>('ncr_books');
  const { data: packages } = useCollection<Package>('packages');
  const { data: settingsList } = useCollection<PricingSettings>('settings');
  const { data: companySettingsList } = useCollection<CompanySettings>('company_settings');
  const { data: jobs } = useCollection<Job>('jobs');
  
  const settings = settingsList[0] || DEFAULT_PRICING_SETTINGS;
  const company = companySettingsList[0];

  const [isSaving, setIsSaving] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const [formData, setFormData] = useState<Partial<Quote>>({
    quoteNumber: `Quote-${new Date().getFullYear()}-${Math.floor(1 + Math.random() * 9999)}`,
    clientId: '',
    items: [],
    isExpress: false,
    status: 'Draft',
    createdAt: Date.now(),
    expiryDate: Date.now() + (30 * 24 * 60 * 60 * 1000) // 30 days
  });

  const [items, setItems] = useState<Partial<QuoteItem>[]>([]);

  useEffect(() => {
    if (quote) {
      setFormData(quote);
      setItems(quote.items);
    } else {
      setFormData({
        quoteNumber: `Quote-${new Date().getFullYear()}-${Math.floor(1 + Math.random() * 9999)}`,
        clientId: '',
        items: [],
        isExpress: false,
        status: 'Draft',
        createdAt: Date.now(),
        expiryDate: Date.now() + (30 * 24 * 60 * 60 * 1000)
      });
      
      if (prefilledItem) {
        const newItem: Partial<QuoteItem> = {
          id: Math.random().toString(36).substr(2, 9),
          type: prefilledItem.type as any,
          originId: prefilledItem.originId,
          quantity: prefilledItem.quantity,
          unitCost: 0,
          totalPrice: 0,
          totalCost: 0,
          description: '',
          width: 0,
          length: 0
        };
        setItems([newItem]);
        // We'll let the next update cycle or a manual trigger handle initial calculation
        // Or we can manually trigger update logic here
      } else {
        setItems([]);
      }
    }
  }, [quote, isOpen, prefilledItem]);

  // Initial calculation for prefilled item
  useEffect(() => {
    if (prefilledItem && items.length === 1 && items[0].originId === prefilledItem.originId && items[0].description === '') {
      updateItem(0, { originId: prefilledItem.originId, type: prefilledItem.type as any });
    }
  }, [items, prefilledItem]);

  const addItem = () => {
    setItems([...items, { 
      id: Math.random().toString(36).substr(2, 9), 
      type: 'Product',
      originId: '',
      description: '', 
      quantity: 1, 
      unitCost: 0, 
      totalPrice: 0, 
      totalCost: 0,
      width: 0,
      length: 0,
      productId: '',
      materialId: ''
    }]);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, updates: Partial<QuoteItem>) => {
    const newItems = [...items];
    const currentItem = newItems[index];
    
    let materialId = updates.materialId ?? currentItem.materialId;
    let unitCost = updates.unitCost ?? currentItem.unitCost;
    let description = updates.description ?? currentItem.description;
    let type = updates.type ?? currentItem.type;
    let originId = updates.originId ?? currentItem.originId;

    // Reset originId if type changes
    if (updates.type && updates.type !== currentItem.type) {
      originId = '';
      updates.originId = '';
    }

    // Logic based on type and originId
    if (updates.originId && (updates.originId !== currentItem.originId || updates.type !== currentItem.type)) {
      if (type === 'Product') {
        const product = products.find(p => p.id === updates.originId);
        if (product) {
          materialId = product.defaultMaterialId;
          description = product.name;
          const material = materials.find(m => m.id === materialId);
          if (material) unitCost = material.costPrice;
        }
      } else if (type === 'Material') {
        const material = materials.find(m => m.id === updates.originId);
        if (material) {
          description = material.name;
          unitCost = material.costPrice;
          materialId = material.id;
        }
      } else if (type === 'NCR') {
        const ncr = ncrBooks.find(b => b.id === updates.originId);
        if (ncr) {
          description = ncr.name;
          // For NCR, we might default to the first tier or a base cost
          unitCost = ncr.pricingGrid?.[0]?.sell || 0;
        }
      } else if (type === 'Package') {
        const pkg = packages.find(p => p.id === updates.originId);
        if (pkg) {
          description = pkg.name;
          unitCost = pkg.packagePrice;
        }
      }
      updates.description = description;
      updates.unitCost = unitCost;
      updates.materialId = materialId;
    }

    // If material changed (only relevant for Product type usually)
    if (updates.materialId && updates.materialId !== currentItem.materialId && type === 'Product') {
      const material = materials.find(m => m.id === updates.materialId);
      if (material) unitCost = material.costPrice;
      updates.unitCost = unitCost;
    }

    newItems[index] = { ...newItems[index], ...updates };
    const item = newItems[index];

    // Helper to ensure we don't pass NaN to inputs
    const safeNum = (val: any) => (val === null || val === undefined || isNaN(val)) ? '' : val;

    // Find relevant entities for dimension checking
    const product = products.find(p => p.id === item.originId);
    const material = materials.find(m => m.id === (item.type === 'Material' ? item.originId : item.materialId));
    const isArea = (item.type === 'Product' && product?.costingMethod === 'Area') || 
                   (item.type === 'Material' && (material?.unit === 'm²' || material?.unit === 'sqm'));

    // Recalculate totals
const q = item.quantity ?? 1;
const u = item.unitCost ?? 0;
const w = item.width ?? 0;
const l = item.length ?? 0;

let computedPrice = 0;
let computedCost = 0;

if (item.type === 'Product') {
  const machine = machines.find(m => m.id === product?.defaultMachineId);
  
  const matCost = material?.costPrice || u;
  let machineCost = 0;

  if (machine) {
    if (machine.costUnit === 'm²') {
      machineCost = sqMmToSqM(w * l) * (machine.hourlyRate || 0) * q;
    } else if (machine.costUnit === 'page' || machine.costUnit === 'copy') {
      machineCost = q * (machine.hourlyRate || 0);
    } else if (machine.costUnit === 'hr') {
      machineCost = ((product?.setupTime || 0) / 60) * (machine.hourlyRate || 0);
    } else {
      machineCost = q * (machine.hourlyRate || 0);
    }
  }

  const markup = 1 + ((product?.markupPercent || 40) / 100);

  if (isArea) {
    computedCost = (sqMmToSqM(w * l) * matCost * q) + machineCost;
  } else {
    computedCost = (matCost * q) + machineCost;
  }

  computedPrice = computedCost * markup;

} else if (item.type === 'NCR') {
  const ncr = ncrBooks.find(b => b.id === item.originId);
  if (ncr && ncr.pricingGrid) {
    const matchingTier = [...ncr.pricingGrid]
      .sort((a, b) => b.quantity - a.quantity)
      .find(t => q >= t.quantity);

    const tierPrice = matchingTier
      ? matchingTier.sell
      : (ncr.pricingGrid[0]?.sell || 0);

    computedPrice = tierPrice * q;
    computedCost = computedPrice * 0.6;
    item.unitCost = tierPrice;
  } else {
    // fallback = manual pricing
    computedPrice = q * u;
    computedCost = computedPrice * 0.6;
  }

} else if (item.type === 'Material') {
  // ✅ FIX: ALWAYS use entered rate (NO MARKUP)
  computedPrice = q * u;
  computedCost = computedPrice * 0.6; // optional

} else if (item.type === 'Package') {
  computedPrice = q * u;
  computedCost = computedPrice * 0.6;
}

// Final assignment
item.totalPrice = computedPrice;
item.totalCost = computedCost;