import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  nativeAccessEditSchema,
  subscriptionPlanEditSchema,
  subscriptionPromotionEditSchema,
} from "@animesoul/contracts";
import { AuthService, type AuthRequest } from "../auth/auth.service.js";
import { parse } from "../auth/auth.controller.js";
import { SubscriptionsService } from "./subscriptions.service.js";
@Controller("api/subscription")
export class SubscriptionController {
  constructor(@Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService) {}
  @Get()
  @Header("Cache-Control", "private, no-store")
  async status(@Req() request: AuthRequest) {
    return this.subscriptions.status(await this.subscriptions.viewer(request));
  }
}
@Controller("api/admin/subscriptions")
export class SubscriptionAdminController {
  constructor(
    @Inject(SubscriptionsService) private readonly subscriptions: SubscriptionsService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  @Get() async catalog(@Req() request: AuthRequest) {
    await this.auth.requireSession(request, "admin");
    return this.subscriptions.catalog();
  }
  @Post("plan") async plan(@Req() request: AuthRequest, @Body() body: unknown) {
    const actor = await this.auth.writeSession(request, "admin");
    return this.subscriptions.plan(actor.userId, parse(subscriptionPlanEditSchema, body));
  }
  @Post("promotion") async promotion(@Req() request: AuthRequest, @Body() body: unknown) {
    const actor = await this.auth.writeSession(request, "admin");
    return this.subscriptions.promotion(actor.userId, parse(subscriptionPromotionEditSchema, body));
  }
  @Get("access") async access(@Req() request: AuthRequest, @Query("username") username: string) {
    await this.auth.requireSession(request, "admin");
    if (typeof username !== "string" || !username.trim() || username.length > 40)
      throw new BadRequestException();
    return this.subscriptions.status(await this.subscriptions.userId(username));
  }
  @Post("access") async grant(@Req() request: AuthRequest, @Body() body: unknown) {
    const actor = await this.auth.writeSession(request, "admin");
    return this.subscriptions.grant(actor.userId, parse(nativeAccessEditSchema, body));
  }
}
