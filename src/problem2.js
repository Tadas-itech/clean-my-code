const validateApplication = async (body) => {
    if (body.recontractInProgress) {
        logger.info('Skipping add item, recontracting progress in add.application.item.controller', body.lease_id);
        return {};
    }

    const {
        application_id,
        asset_price,
        kafene_downpayment = 0,
        merchant_downpayment = 0,
        shipping_cost = 0,
        item_id
    } = body;

    try {
        const application = await db.oneOrNone(applicationQuery.getApplicationById, [application_id]);
        if (!application) {
            logger.error(`No application with ID ${application_id} in add.application.item.controller`);
            throw new KafeneError('There is no application with this id');
        }
        if (!applicationCanEdit(application.application_status) && !body.skipValidations) {
            logger.error('Application status not available to add items in add.application.item.controller');
            throw new KafeneError('This application status is not available to add items');
        }

        // todo extract to a separate function and add spec
        let { approval_amount } = application;
        const price = parseFloat(asset_price);

        approval_amount = parseFloat(approval_amount);

        let down_payment = parseFloat(kafene_downpayment) + parseFloat(merchant_downpayment);
        down_payment = parseFloat(down_payment);

        const totalPrice = price + parseFloat(shipping_cost);
        const approvalAmountWithBuffer = approval_amount * 1.1;

        const nestApp = await appInstance;
        const sopService = nestApp.get(SecondOfferPriceService);

        try {
            const sopRecord = await sopService.getSopRecordFromDB(application.id);
            if (!sopRecord && totalPrice > approvalAmountWithBuffer + down_payment) {
                throw new KafeneError(
                    `This item price is above the limit ${approval_amount} allowed for this application`
                );
            }

            const errorMessage = validateDeliveryFee({
                item_id,
                shipping_cost,
                applicationState: application.state
            });

            if (errorMessage) {
                logger.error(`Delivery fee validation failed for application - ${application.id}`);
                throw new KafeneError(errorMessage);
            }

            try {
                const req = {
                    body: {
                        sopRecord,
                        email,
                        user_type: 'dashboard_user'
                    }
                };
                await validateUserApplication(req);
                this.logger.info(
                    `Finished sending password reset email for activated merchant - [${email}] in disableMerchant merchants.service`
                );
            } catch (e) {
                this.logger.error(
                    `Failed to complete email reset password request -[${email}] in disableMerchant merchants.service`,
                    e
                );
                throw new HttpException('Merchant Created. Failed To Send Password Reset Mail', HttpStatus.BAD_REQUEST);
            }
        } catch (error) {
            logger.error(error.message, error);
            throw new KafeneError(error.message);
        }
    } catch (error) {
        logger.error('Database error from validateApplication in add.application.item.controller', error);
        throw new KafeneError();
    }
};