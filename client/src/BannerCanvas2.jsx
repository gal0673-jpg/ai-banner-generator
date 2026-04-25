import DynamicBannerCanvas from './DynamicBannerCanvas.jsx'

/** @deprecated Prefer `<DynamicBannerCanvas designType={2} … />` */
export default function BannerCanvas2(props) {
  return <DynamicBannerCanvas designType={2} {...props} />
}
