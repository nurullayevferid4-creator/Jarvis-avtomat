// Shopify Admin GraphQL sənədləri. Hamısı MCP "validate_graphql_codeblocks" ilə sxemə qarşı yoxlanıb
// (bax docs/SHOPIFY.md "Nə yoxlanıb"). Dəyişiklikdən sonra yenidən yoxlamaq lazımdır.
// Oxuma sənədlərində müştəri şəxsi məlumatı minimaldır: yalnız çatdırılma ünvanındakı ad və şəhər (customers scope tələb olunmasın deyə `customer` sahəsi sorğulanmır).

export const Q_SHOP = `query ShopInfo {
  shop {
    name
    myshopifyDomain
    currencyCode
    ianaTimezone
    primaryDomain { url }
  }
}`;

export const Q_SCOPES = `query AppScopes {
  currentAppInstallation {
    accessScopes { handle }
  }
}`;

export const Q_PRODUCTS = `query SearchProducts($first: Int!, $query: String) {
  products(first: $first, query: $query) {
    nodes {
      id
      title
      handle
      status
      totalInventory
      variants(first: 10) {
        nodes { id title sku price }
      }
    }
  }
}`;

export const Q_PRODUCT = `query GetProduct($id: ID!) {
  product(id: $id) {
    id
    title
    handle
    status
    descriptionHtml
    vendor
    productType
    tags
    totalInventory
    mediaCount { count }
    seo { title description }
    variants(first: 50) {
      nodes {
        id
        title
        sku
        price
        compareAtPrice
        inventoryItem { id tracked }
      }
    }
  }
}`;

export const Q_ORDERS = `query ListOrders($first: Int!, $query: String) {
  orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
    nodes {
      id
      name
      createdAt
      displayFinancialStatus
      displayFulfillmentStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      shippingAddress { firstName city }
    }
  }
}`;

export const Q_ORDER = `query GetOrder($id: ID!) {
  order(id: $id) {
    id
    name
    createdAt
    cancelledAt
    displayFinancialStatus
    displayFulfillmentStatus
    currentTotalPriceSet { shopMoney { amount currencyCode } }
    shippingAddress { firstName city }
    lineItems(first: 20) {
      nodes { title quantity sku }
    }
  }
}`;

export const Q_INVENTORY = `query ProductInventory($id: ID!) {
  product(id: $id) {
    id
    title
    variants(first: 50) {
      nodes {
        id
        title
        sku
        inventoryItem {
          id
          tracked
          inventoryLevels(first: 10) {
            nodes {
              location { id name }
              quantities(names: ["available"]) { name quantity }
            }
          }
        }
      }
    }
  }
}`;

export const Q_INVENTORY_LEVEL = `query InventoryLevelAt($itemId: ID!, $locationId: ID!) {
  inventoryItem(id: $itemId) {
    id
    tracked
    inventoryLevel(locationId: $locationId) {
      id
      quantities(names: ["available"]) { name quantity }
    }
  }
}`;

export const Q_LOCATIONS = `query ListLocations {
  locations(first: 10) {
    nodes { id name isActive }
  }
}`;

export const Q_COLLECTIONS = `query ListCollections($first: Int!, $query: String) {
  collections(first: $first, query: $query) {
    nodes {
      id
      title
      handle
      productsCount { count }
    }
  }
}`;

export const Q_PRODUCT_COLLECTIONS = `query ProductCollections($id: ID!) {
  product(id: $id) {
    id
    collections(first: 50) {
      nodes { id }
    }
  }
}`;

export const Q_WEBHOOKS = `query ListWebhooks {
  webhookSubscriptions(first: 50) {
    nodes {
      id
      topic
      uri
    }
  }
}`;

export const M_PRODUCT_CREATE = `mutation CreateProduct($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
  productCreate(product: $product, media: $media) {
    product {
      id
      title
      handle
      status
      variants(first: 1) {
        nodes { id inventoryItem { id } }
      }
    }
    userErrors { field message }
  }
}`;

export const M_VARIANTS_UPDATE = `mutation UpdateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    productVariants { id title sku price compareAtPrice }
    userErrors { field message code }
  }
}`;

export const M_VARIANTS_CREATE = `mutation CreateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $productId, variants: $variants) {
    productVariants { id title sku price inventoryItem { id } }
    userErrors { field message code }
  }
}`;

export const M_PRODUCT_UPDATE = `mutation UpdateProduct($product: ProductUpdateInput!) {
  productUpdate(product: $product) {
    product {
      id
      title
      handle
      status
      descriptionHtml
      vendor
      productType
      tags
      seo { title description }
    }
    userErrors { field message }
  }
}`;

export const M_INVENTORY_ACTIVATE = `mutation ActivateInventory($inventoryItemId: ID!, $locationId: ID!) {
  inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId) {
    inventoryLevel { id }
    userErrors { field message }
  }
}`;

export const M_INVENTORY_SET = `mutation SetInventory($input: InventorySetQuantitiesInput!) {
  inventorySetQuantities(input: $input) {
    inventoryAdjustmentGroup {
      id
      changes { name delta }
    }
    userErrors { field message code }
  }
}`;

export const M_COLLECTION_ADD = `mutation AddToCollection($id: ID!, $productIds: [ID!]!) {
  collectionAddProducts(id: $id, productIds: $productIds) {
    collection { id title }
    userErrors { field message }
  }
}`;

export const M_WEBHOOK_CREATE = `mutation CreateWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
  webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
    webhookSubscription { id topic }
    userErrors { field message }
  }
}`;

export const ALL_DOCS = { Q_SHOP, Q_SCOPES, Q_PRODUCTS, Q_PRODUCT, Q_ORDERS, Q_ORDER, Q_INVENTORY, Q_INVENTORY_LEVEL, Q_LOCATIONS, Q_COLLECTIONS, Q_PRODUCT_COLLECTIONS, Q_WEBHOOKS, M_PRODUCT_CREATE, M_VARIANTS_UPDATE, M_VARIANTS_CREATE, M_PRODUCT_UPDATE, M_INVENTORY_ACTIVATE, M_INVENTORY_SET, M_COLLECTION_ADD, M_WEBHOOK_CREATE };
