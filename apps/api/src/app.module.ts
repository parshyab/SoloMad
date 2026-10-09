import { Module } from "@nestjs/common";
import { AccountController } from "./account.controller";
import { ActivitiesController } from "./activities.controller";
import { AdminController } from "./admin.controller";
import { CoreController } from "./core.controller";
import { providers } from "./context";
import { SocialController } from "./social.controller";

@Module({
  controllers: [CoreController, ActivitiesController, SocialController, AccountController, AdminController],
  providers,
})
export class AppModule {}
