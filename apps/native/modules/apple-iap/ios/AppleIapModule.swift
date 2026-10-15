import ExpoModulesCore
import StoreKit

enum AppleIapError: Error, LocalizedError {
  case productNotFound(String)
  case unverifiedTransaction

  var errorDescription: String? {
    switch self {
    case .productNotFound(let productId):
      return "Produk \(productId) belum tersedia di App Store."
    case .unverifiedTransaction:
      return "Pembelian tidak bisa diverifikasi perangkat ini."
    }
  }
}

/// StoreKit 2 bridge for the Founder plan. Transactions stay unfinished until
/// the server confirms the purchase, so an interrupted flow can be replayed.
public class AppleIapModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleIap")

    AsyncFunction("getProduct") { (productId: String) -> [String: String]? in
      let products = try await Product.products(for: [productId])
      guard let product = products.first else { return nil }
      return [
        "id": product.id,
        "displayName": product.displayName,
        "displayPrice": product.displayPrice,
      ]
    }

    AsyncFunction("purchase") { (productId: String) -> [String: String] in
      let products = try await Product.products(for: [productId])
      guard let product = products.first else {
        throw AppleIapError.productNotFound(productId)
      }
      let result = try await product.purchase()
      switch result {
      case .success(let verification):
        // Only verified transactions carry a JWS the server will accept.
        guard case .verified(let transaction) = verification else {
          throw AppleIapError.unverifiedTransaction
        }
        return [
          "status": "success",
          "signedTransaction": verification.jwsRepresentation,
          "transactionId": String(transaction.id),
        ]
      case .userCancelled:
        return ["status": "cancelled"]
      case .pending:
        return ["status": "pending"]
      @unknown default:
        return ["status": "pending"]
      }
    }

    // Transaction.unfinished yields VerificationResult<Transaction>; only
    // verified ones can be credited by the server, so only those are exposed.
    AsyncFunction("finish") { (transactionId: String) -> Bool in
      for await result in Transaction.unfinished {
        guard case .verified(let transaction) = result, String(transaction.id) == transactionId else {
          continue
        }
        await transaction.finish()
        return true
      }
      return false
    }

    AsyncFunction("unfinished") { () -> [[String: String]] in
      var items: [[String: String]] = []
      for await result in Transaction.unfinished {
        guard case .verified(let transaction) = result else { continue }
        items.append([
          "signedTransaction": result.jwsRepresentation,
          "transactionId": String(transaction.id),
        ])
      }
      return items
    }
  }
}
