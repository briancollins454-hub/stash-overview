
import { ShopifyOrder, DecoJob, PhysicalStockItem } from './types';

// Helper to calculate a past date for realistic mock data
const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
};

export const MOCK_PHYSICAL_STOCK: PhysicalStockItem[] = [
  {
    id: 's1',
    ean: '506043210001',
    vendor: 'Stash Shop',
    productCode: 'OMA-HD-L',
    description: 'Omagh RFC Hoodie',
    colour: 'Navy',
    size: 'L',
    quantity: 12,
    isEmbellished: true,
    clubName: 'Omagh RFC',
    addedAt: Date.now() - 86400000 * 5
  },
  {
    id: 's2',
    ean: '506043210001',
    vendor: 'Stash Shop',
    productCode: 'OMA-HD-L',
    description: 'Plain Training Hoodie',
    colour: 'Navy',
    size: 'L',
    quantity: 25,
    isEmbellished: false,
    addedAt: Date.now() - 86400000 * 4
  },
  {
    id: 's3',
    ean: '506043210005',
    vendor: 'Gilbert',
    productCode: 'BEL-SKT-10',
    description: 'Netball Skort',
    colour: 'Navy',
    size: '10',
    quantity: 8,
    isEmbellished: true,
    clubName: 'Belfast Netball',
    addedAt: Date.now() - 86400000 * 10
  },
  {
    id: 's4',
    ean: '506043210999',
    vendor: 'Generic',
    productCode: 'GEN-SOCK',
    description: 'Team Socks',
    colour: 'White',
    size: 'L',
    quantity: 40,
    isEmbellished: false,
    addedAt: Date.now() - 86400000 * 2
  }
];

export const MOCK_SHOPIFY_ORDERS: ShopifyOrder[] = [
  // 1. LATE ORDER - MISSING PO (Action Required)
  {
    id: 'gid://shopify/Order/1',
    orderNumber: '1001',
    customerName: 'John Doe',
    email: 'john@example.com',
    date: daysAgo(7), // > 5 days old
    // Fix: Added missing updatedAt property
    updatedAt: daysAgo(6),
    totalPrice: '150.00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    timelineComments: ['Customer asked for update', 'Ref: 299123'], // Fixed to have a valid code for testing
    items: [
      { 
        // Added missing id property
        id: 'gid://shopify/LineItem/1',
        name: 'Omagh RFC Hoodie - Large', 
        quantity: 1, 
        sku: 'OMA-HD-L', 
        ean: '506043210001', 
        productType: 'Apparel',
        vendor: 'Stash Shop',
        itemStatus: 'unfulfilled',
        decoStatus: '-',
      }
    ],
    tags: ['Omagh Rugby', 'Batch-Oct-25']
  },
  
  // 2. IN PRODUCTION - LINKED CORRECTLY (HAS EMAIL ENQUIRY MOCK)
  {
    id: 'gid://shopify/Order/2',
    orderNumber: '1002',
    customerName: 'Sarah Smith',
    email: 'sarah@example.com',
    date: daysAgo(10),
    // Fix: Added missing updatedAt property
    updatedAt: daysAgo(9),
    totalPrice: '45.00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    timelineComments: ['Moved to Production', 'Deco Job: 285231'], // Updated to start with 2
    items: [
      { 
        // Added missing id property
        id: 'gid://shopify/LineItem/2',
        name: 'Omagh RFC Training Tee - M', 
        quantity: 2, 
        sku: 'OMA-TEE-M',
        ean: '506043210002', 
        productType: 'Apparel',
        vendor: 'Canterbury',
        itemStatus: 'unfulfilled',
      }
    ],
    tags: ['Omagh Rugby']
  },
  
  // 3. READY TO SHIP (Awaiting Shipping)
  {
    id: 'gid://shopify/Order/3',
    orderNumber: '1003',
    customerName: 'Emma White',
    email: 'emma@example.com',
    date: daysAgo(18),
    // Fix: Added missing updatedAt property
    updatedAt: daysAgo(17),
    totalPrice: '200.00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'partial',
    timelineComments: ['Job 285232'], // Updated to start with 2
    items: [
      { 
        // Added missing id property
        id: 'gid://shopify/LineItem/3',
        name: 'Netball Skort - 10', 
        quantity: 1, 
        sku: 'BEL-SKT-10',
        ean: '506043210005',
        productType: 'Apparel',
        vendor: 'Gilbert',
        itemStatus: 'fulfilled',
        tracking: {
            number: 'GB220491823',
            url: 'https://www.royalmail.com/track-your-item',
            date: daysAgo(1)
        },
      },
      { 
        // Added missing id property
        id: 'gid://shopify/LineItem/4',
        name: 'Team Socks', 
        quantity: 2, 
        sku: 'GEN-SOCK',
        ean: '506043210999',
        productType: 'Accessory',
        vendor: 'Generic',
        itemStatus: 'unfulfilled',
      },
      { 
        // Added missing id property
        id: 'gid://shopify/LineItem/5',
        name: 'Add Initials', 
        quantity: 1, 
        sku: 'SRV-INIT',
        ean: '',
        productType: 'Service',
        itemStatus: 'fulfilled' 
      }
    ],
    tags: ['Belfast Netball']
  },

  // 4. NEW ORDER (Normal, no PO yet)
  {
    id: 'gid://shopify/Order/4',
    orderNumber: '1005',
    customerName: 'New Club Member',
    email: 'new@example.com',
    date: daysAgo(2), // < 5 days
    // Fix: Added missing updatedAt property
    updatedAt: daysAgo(1),
    totalPrice: '80.00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    timelineComments: [],
    items: [
      { 
        // Added missing id property
        id: 'gid://shopify/LineItem/6',
        name: 'Rugby Shorts', 
        quantity: 1, 
        sku: 'RUG-SHO',
        ean: '506043210044',
        productType: 'Apparel',
        vendor: 'Stash Shop',
        itemStatus: 'unfulfilled',
      }
    ],
    tags: ['Omagh Rugby']
  },

  // 5. COMPLETED ORDER (Historical)
  {
    id: 'gid://shopify/Order/5',
    orderNumber: '998',
    customerName: 'Historical User',
    email: 'history@example.com',
    date: daysAgo(30),
    // Fix: Added missing updatedAt property
    updatedAt: daysAgo(10),
    closedAt: daysAgo(10), // Closed 10 days ago. Duration = 20 days - 10 days ago approx 14 working days?
    totalPrice: '120.00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'fulfilled',
    timelineComments: ['Job 285100'], // Updated to start with 2
    items: [
      { 
        // Added missing id property
        id: 'gid://shopify/LineItem/7',
        name: 'Rugby Jersey', 
        quantity: 1, 
        sku: 'RUG-JER',
        ean: '506043210099',
        productType: 'Apparel',
        vendor: 'Canterbury',
        itemStatus: 'fulfilled',
        tracking: {
            number: 'GB111111',
            url: '#',
            date: daysAgo(10)
        },
      }
    ],
    tags: ['Omagh Rugby']
  },

  // 6. MTO ORDER (Tag Based)
  {
    id: 'gid://shopify/Order/6',
    orderNumber: '1006',
    customerName: 'Special Order Sam',
    email: 'sam@example.com',
    date: daysAgo(45), // Old order
    // Fix: Added missing updatedAt property
    updatedAt: daysAgo(40),
    totalPrice: '250.00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    timelineComments: ['MTO Job started'],
    items: [
      { 
        // Added missing id property
        id: 'gid://shopify/LineItem/8',
        name: 'Custom Blazer', 
        quantity: 1, 
        sku: 'CUST-BLZ',
        productType: 'Apparel',
        vendor: 'Club 1823',
        itemStatus: 'unfulfilled',
      }
    ],
    tags: ['Omagh Rugby', 'MTO']
  },

  // 7. MTO ORDER (Item Name Based)
  {
    id: 'gid://shopify/Order/7',
    orderNumber: '1007',
    customerName: 'Kit Manager',
    email: 'kit@example.com',
    date: daysAgo(25),
    // Fix: Added missing updatedAt property
    updatedAt: daysAgo(24),
    totalPrice: '1200.00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'partial',
    timelineComments: ['Job 299999'],
    items: [
      { 
        // Added missing id property
        id: 'gid://shopify/LineItem/9',
        name: 'MTO - Sublimated Jersey', 
        quantity: 20, 
        sku: 'SUB-JER-MTO',
        productType: 'Apparel',
        vendor: 'Stash Pro',
        itemStatus: 'unfulfilled',
      },
      {
          // Added missing id property
          id: 'gid://shopify/LineItem/10',
          name: 'Stock Socks',
          quantity: 20,
          sku: 'SOCK-BLK',
          productType: 'Accessory',
          vendor: 'Generic',
          itemStatus: 'fulfilled',
      }
    ],
    tags: ['Belfast Netball']
  },

  // 8. QUICK FULFILLED ORDER (For Stats)
  {
    id: 'gid://shopify/Order/8',
    orderNumber: '990',
    customerName: 'Fast Freddie',
    email: 'fast@example.com',
    date: daysAgo(8),
    // Fix: Added missing updatedAt property
    updatedAt: daysAgo(2),
    closedAt: daysAgo(2), // 6 days turnaround
    totalPrice: '50.00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'fulfilled',
    timelineComments: ['Job 285101'], // Updated to start with 2
    items: [{ id: 'gid://shopify/LineItem/11', name: 'Cap', quantity: 1, sku: 'CAP', vendor: 'Nike', itemStatus: 'fulfilled' }],
    tags: ['Belfast Netball']
  },

  // 9. MANUAL LINK EXAMPLE (User Request)
  {
    id: 'gid://shopify/Order/44827',
    orderNumber: '44827',
    customerName: 'Manual Link Test',
    email: 'manual@example.com',
    date: daysAgo(12),
    // Fix: Added missing updatedAt property
    updatedAt: daysAgo(11),
    totalPrice: '180.00',
    paymentStatus: 'paid',
    fulfillmentStatus: 'unfulfilled',
    timelineComments: ['Order #222709 BRFC Stash Shop 44827 & 41594 Ordered 09.07.25 LB'], 
    items: [
      { 
        // Added missing id property
        id: 'gid://shopify/LineItem/12',
        name: 'Custom Hoody', 
        quantity: 1, 
        sku: 'CUST-HD',
        productType: 'Apparel',
        vendor: 'Stash Shop',
        itemStatus: 'unfulfilled',
      }
    ],
    tags: ['Test Club']
  },
  
  // 10. URGENT ORDER (Due Soon)
  {
      id: 'gid://shopify/Order/9991',
      orderNumber: '1008',
      customerName: 'Urgent User',
      email: 'urgent@example.com',
      date: daysAgo(24), // Approx 2 days remaining SLA
      // Fix: Added missing updatedAt property
      updatedAt: daysAgo(23),
      totalPrice: '100.00',
      paymentStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      timelineComments: [],
      items: [{ id: 'gid://shopify/LineItem/13', name: 'Shorts', quantity: 1, sku: 'SHO', vendor: 'Canterbury', itemStatus: 'unfulfilled' }],
      tags: ['Omagh Rugby']
  },

  // 11. JUST LATE ORDER (< 5 Days overdue)
  {
      id: 'gid://shopify/Order/9992',
      orderNumber: '1009',
      customerName: 'Late User 1',
      email: 'late1@example.com',
      date: daysAgo(30), 
      // Fix: Added missing updatedAt property
      updatedAt: daysAgo(29),
      totalPrice: '100.00',
      paymentStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      timelineComments: [],
      items: [{ id: 'gid://shopify/LineItem/14', name: 'Shorts', quantity: 1, sku: 'SHO', vendor: 'Canterbury', itemStatus: 'unfulfilled' }],
      tags: ['Omagh Rugby']
  },

  // 12. VERY LATE ORDER (> 10 Days overdue)
  {
      id: 'gid://shopify/Order/9993',
      orderNumber: '1010',
      customerName: 'Very Late User',
      email: 'vlate@example.com',
      date: daysAgo(45), 
      // Fix: Added missing updatedAt property
      updatedAt: daysAgo(44),
      totalPrice: '100.00',
      paymentStatus: 'paid',
      fulfillmentStatus: 'unfulfilled',
      timelineComments: [],
      items: [{ id: 'gid://shopify/LineItem/15', name: 'Shorts', quantity: 1, sku: 'SHO', vendor: 'Canterbury', itemStatus: 'unfulfilled' }],
      tags: ['Omagh Rugby']
  }
];

export const MOCK_DECO_JOBS: DecoJob[] = [
  {
    id: 'deco-101',
    jobNumber: '285231', 
    poNumber: '1002', 
    jobName: 'Omagh Training Tee Batch',
    customerName: 'Omagh Rugby Club',
    status: 'Production', 
    dateOrdered: daysAgo(12),
    productionDueDate: daysAgo(-5),
    dateDue: daysAgo(5), 
    itemsProduced: 1,
    totalItems: 2, 
    notes: 'In stitching',
    productCode: 'OMA-TEE-M',
    items: [
        { 
            productCode: 'OMA-TEE-M', 
            name: 'Omagh Tee - Black - M', 
            quantity: 2, 
            ean: '506043210002',
            status: 'Printing', 
            isReceived: true, isProduced: false, isShipped: false,
            procurementStatus: 60, // Received (Green)
            productionStatus: 40, // Awaiting Production (Grey)
            shippingStatus: 0 
        }
    ]
  },
  {
    id: 'deco-102',
    jobNumber: '285232', 
    poNumber: '1003',
    jobName: 'Belfast Netball Kit',
    customerName: 'Belfast Netball',
    status: 'Completed', 
    dateOrdered: daysAgo(20),
    productionDueDate: daysAgo(1),
    dateDue: daysAgo(-1),
    itemsProduced: 3,
    totalItems: 3,
    notes: 'Packed and ready',
    productCode: 'BEL-SKT-10',
    items: [
        { 
            productCode: 'BEL-SKT-10', name: 'Netball Skort - Navy - 10', quantity: 1, ean: '506043210005', status: 'Produced', isReceived: true, isProduced: true, isShipped: false,
            procurementStatus: 60, productionStatus: 80, shippingStatus: 40 // Shipped Grey? or Orange? If 40 is partial
        },
        { 
            productCode: 'GEN-SOCK', name: 'Socks - White - L', quantity: 2, ean: '506043210999', status: 'Picked', isReceived: true, isProduced: true, isShipped: false,
            procurementStatus: 60, productionStatus: 80, shippingStatus: 40
        }
    ]
  },
  {
    id: 'deco-100',
    jobNumber: '285100', 
    poNumber: '998',
    jobName: 'Rugby Jersey Order',
    customerName: 'Historical Customer',
    status: 'Shipped',
    dateOrdered: daysAgo(35),
    productionDueDate: daysAgo(12),
    dateDue: daysAgo(10),
    itemsProduced: 1,
    totalItems: 1,
    notes: 'Done',
    productCode: 'RUG-JER',
    items: [
         { 
             productCode: 'RUG-JER', name: 'Rugby Jersey - Green - XL', quantity: 1, ean: '506043210099', status: 'Shipped', isReceived: true, isProduced: true, isShipped: true,
             procurementStatus: 60, productionStatus: 80, shippingStatus: 80 // All Green
         }
    ]
  },
  {
    id: 'deco-222709',
    jobNumber: '222709',
    poNumber: '44827',
    jobName: 'BRFC Stash Shop',
    customerName: 'Manual Link Test',
    status: 'Production',
    dateOrdered: daysAgo(15),
    productionDueDate: daysAgo(5),
    dateDue: daysAgo(0),
    itemsProduced: 0,
    totalItems: 1,
    notes: 'Found via note',
    productCode: 'CUST-HD',
    items: [
        { 
            productCode: 'CUST-HD', name: 'Custom Hoody - Red - L', quantity: 1, ean: '506043219988', status: 'Ordered', isReceived: true, isProduced: false, isShipped: false,
            procurementStatus: 20, // Awaiting Stock (Green per user request "if 20, green tick")
            productionStatus: 20,
            shippingStatus: 0
        }
    ]
  }
];
