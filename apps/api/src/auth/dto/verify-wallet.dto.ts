import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';

export class VerifyWalletDto {
  /**
   * Stellar G-address (56-char base32).
   * Validated structurally here; cryptographic validity is checked during
   * Keypair.fromPublicKey inside the service.
   */
  @IsString()
  @IsNotEmpty({ message: 'walletAddress must not be empty' })
  @Matches(/^G[A-Z2-7]{55}$/, {
    message: 'walletAddress must be a valid Stellar public key (G…)',
  })
  walletAddress: string;

  /**
   * The plain-text nonce string originally issued by POST /auth/nonce.
   * Bounded length so adversarial clients cannot submit oversized payloads
   * that would be hashed/looked up in the nonce store (griefing guard).
   */
  @IsString()
  @IsNotEmpty({ message: 'nonce must not be empty' })
  @MaxLength(256, { message: 'nonce must be at most 256 characters' })
  nonce: string;

  /**
   * Base64-encoded Ed25519 signature produced by Freighter over the nonce.
   * Bounded length to reject malformed/adversarial signature blobs before
   * they reach server-side verification (source of truth).
   */
  @IsString()
  @IsNotEmpty({ message: 'signature must not be empty' })
  @MaxLength(512, { message: 'signature must be at most 512 characters' })
  signature: string;
}
