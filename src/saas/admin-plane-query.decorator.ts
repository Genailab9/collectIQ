import { SetMetadata } from '@nestjs/common';

export const ADMIN_PLANE_QUERY_KEY = 'collectiq:admin-plane-query';

export const AdminPlaneQuery = (): MethodDecorator => SetMetadata(ADMIN_PLANE_QUERY_KEY, true);
