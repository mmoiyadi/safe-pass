/**
 * Builds registration/login payloads for tests using the REAL client crypto, so what the tests
 * send is byte-for-byte what a browser would send.
 *
 * This file is the one place a test may reach across into frontend/src/crypto. Production
 * backend code may not, and eslint enforces that (Constitution Principle I).
 */
import { buildLoginRequest, buildRegistrationRequest } from '../../../frontend/src/crypto/enrolment.js';
import type { LoginRequest, RegisterRequest } from '@pm/shared';

export async function registration(
  email: string,
  masterPassword: string,
): Promise<RegisterRequest> {
  return (await buildRegistrationRequest(email, masterPassword)).request;
}

export async function login(email: string, masterPassword: string): Promise<LoginRequest> {
  return buildLoginRequest(email, masterPassword);
}
